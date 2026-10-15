// askfirst-gate v4B 测试台（DSH 适配版）。用法: node test-gate.js [被测hook路径]
// 每次运行构建独立沙箱(时间戳 sid/目录)，断言 {exit, stdout, stderr}。
// 与 ZCode 版差异：payload 为 DSH claude-bridge 形状（session_id/tool_name/tool_input/cwd）；
// advisory 走 PostToolUse（DSH 的 PreToolUse additionalContext 会被 bridge 丢弃）；
// M1/翻转对账在 Stop 侧为 exit 2 steer（DSH 的 Stop additionalContext 同样被丢弃）；
// M1 会话文件用 DSH sessions 目录形状（--slug--/session-<id>/session.v4.jsonl[.zstd]）。
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const HOOK = process.argv[2] || path.join(__dirname, 'askfirst-gate.dsh.js');
const HOME = process.env.USERPROFILE || process.env.HOME;
const TS = Date.now();
const SID = `gatetest-${TS}`;
const NONGIT = path.join(HOME, `.dsh-gate-test-nongit-${TS}`);
const REPO = path.join(HOME, `.dsh-gate-test-repo-${TS}`);
const SCRATCH_SCRIPT = path.join(os.tmpdir(), `gatetest-scan-${TS}.js`);
const TMPSCRATCH = path.join(os.tmpdir(), `gatetest-tmp-${TS}.txt`);
const MEMFILE = path.join(HOME, '.zcode', 'cli', 'memories', 'projects', `gatetest-${TS}`, 'memory', 'MEMORY.md');
const M1DIR = path.join(os.tmpdir(), `gatetest-m1-${TS}`);

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; failures.push(name + (extra ? ' :: ' + extra : '')); console.log('  FAIL', name, extra || ''); }
}
function run(event, payload, env) {
  const r = spawnSync(process.execPath, [HOOK, event], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 10000,
    env: env ? { ...process.env, ...env } : process.env,
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
const submit = (prompt) => run('UserPromptSubmit', { session_id: SID, prompt });
const edit = (fp) => run('PreToolUse', { session_id: SID, tool_name: 'edit', tool_input: { file_path: fp, old_string: 'a', new_string: 'b' }, cwd: HOME });
const pedit = (fp) => run('PostToolUse', { session_id: SID, tool_name: 'edit', tool_input: { file_path: fp }, cwd: HOME });
const bash = (command, cwd) => run('PreToolUse', { session_id: SID, tool_name: 'pwsh', tool_input: { command }, cwd: cwd || HOME });
// v6(D) 状态目录改为按 cwd 优先落工作区（`<cwd>/.dsh-hooks-state`），测试台按同一规则定位。
const STATE_DIRS = () => [path.join(HOME, '.dsh-hooks-state'), path.join(os.tmpdir(), 'dsh-askfirst-state'), path.join(HOME, '.dsh', 'hooks', 'state')];
const stateAt = (dir, sid) => { try { return JSON.parse(fs.readFileSync(path.join(dir, `zcode-askfirst-${sid || SID}.json`), 'utf8')); } catch { return null; } };
const state = (sid) => { for (const d of STATE_DIRS()) { const s = stateAt(d, sid); if (s) return s; } return null; };
const clearState = (sid) => { for (const d of STATE_DIRS()) { try { fs.rmSync(path.join(d, `zcode-askfirst-${sid}.json`), { force: true }); } catch {} } };
const W = (p) => String(p).replace(/\\/g, '/');

// ── 沙箱 ──
fs.mkdirSync(NONGIT, { recursive: true });
fs.writeFileSync(path.join(NONGIT, 'old.txt'), 'pre-existing content');
fs.writeFileSync(path.join(NONGIT, 'old2.txt'), 'for redirect test');
fs.mkdirSync(REPO, { recursive: true });
fs.writeFileSync(path.join(REPO, 'tracked.txt'), 'tracked');
const g = (...a) => spawnSync('git', ['-C', REPO, ...a], { encoding: 'utf8' });
g('init', '-q'); g('add', 'tracked.txt');
g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
fs.writeFileSync(path.join(REPO, 'untracked.txt'), 'untracked pre-existing');
fs.writeFileSync(SCRATCH_SCRIPT, "const fs=require('fs');\nfs.rmSync('D:/demo/wipe-target/x', {recursive:true, force:true});\n");
fs.writeFileSync(TMPSCRATCH, 'x');
fs.mkdirSync(path.dirname(MEMFILE), { recursive: true });
fs.writeFileSync(MEMFILE, 'test memory');
fs.mkdirSync(M1DIR, { recursive: true });
clearState(SID);

console.log(`sandbox: sid=${SID}\n  nongit=${NONGIT}\n  repo=${REPO}\n  scratchScript=${SCRATCH_SCRIPT}\n  m1dir=${M1DIR}`);

// ── T1 ambient 不重置任务状态 ──
console.log('T1 ambient');
let r = submit('调研一下GLM的缓存计费是什么机制');            // 检索
ok('t1a 常规提示无崩溃', r.code === 0);
r = submit('Current runtime context. This snapshot supersedes earlier runtime-context snapshots.');
r = submit('Time sampled while preparing turn 1, step 1: 2026-10-04T12:00:00+08:00');
const st1 = state();
ok('t1b ambient 后类型保持检索', st1 && st1.type === '检索', JSON.stringify(st1 && st1.type));
r = pedit(path.join(REPO, 'tracked.txt'));
ok('t1c ambient 后漂移仍一次性触发', r.out.includes('[类型漂移'), r.out.slice(0, 80));
r = pedit(path.join(REPO, 'tracked.txt'));
ok('t1d 第二次落笔不再触发', !r.out.includes('[类型漂移') && r.code === 0);

// ── T2 中文续接不重置 ──
console.log('T2 续接');
const SID2 = SID + '-c';
const submit2 = (p) => run('UserPromptSubmit', { session_id: SID2, prompt: p });
const pedit2 = (fp) => run('PostToolUse', { session_id: SID2, tool_name: 'edit', tool_input: { file_path: fp }, cwd: HOME });
submit2('检查一下这个项目的代码有没有明显的问题');
submit2('继续');
submit2('修');
let st2 = state(SID2);
ok('t2a 续接后类型保持诊断', st2 && st2.type === '诊断', JSON.stringify(st2 && st2.type));
r = pedit2(path.join(REPO, 'tracked.txt'));
ok('t2b 诊断任务落笔收诊断纪律(非漂移)', r.out.includes('[诊断纪律'), r.out.slice(0, 80));

// ── T3 记忆目录写静默（Pre 硬拦豁免 + 无 advisory） ──
console.log('T3 记忆目录');
r = submit('检查一下记忆文件现状');
r = edit(MEMFILE);
ok('t3a 记忆写零拦截', r.code === 0 && !r.err, r.err.slice(0, 60));
r = pedit(MEMFILE);
ok('t3b 记忆写零 advisory', r.code === 0 && !r.out, r.out.slice(0, 60));

// ── T4 unknown 首笔中性对账 ──
console.log('T4 unknown');
submit('前端界面？');
r = pedit(path.join(REPO, 'tracked.txt'));
ok('t4a unknown 首笔收中性对账', r.out.includes('[三件套对账') || (r.out.includes('unknown') && r.code === 0), r.out.slice(0, 90));
r = pedit(path.join(REPO, 'tracked.txt'));
ok('t4b 第二次不再触发', !r.out.includes('[三件套对账') && r.code === 0);

// ── T5 检查不再判检索 ──
console.log('T5 检查分类');
const SID5 = SID + '-e';
run('UserPromptSubmit', { session_id: SID5, prompt: '检查一下现在zcode wallet这个skill怎么写的，我感觉可能有过时的地方' });
let st5 = state(SID5);
ok('t5a 检查一下→诊断', st5 && st5.type === '诊断', JSON.stringify(st5 && st5.type));

// ── T6 真漂移留痕 ──
console.log('T6 漂移留痕');
const SID6 = SID + '-f';
const submit6 = (p) => run('UserPromptSubmit', { session_id: SID6, prompt: p });
const pedit6 = (fp) => run('PostToolUse', { session_id: SID6, tool_name: 'edit', tool_input: { file_path: fp }, cwd: HOME });
submit6('调研一下当前市场的竞品有哪些');
r = pedit6(path.join(REPO, 'tracked.txt'));
ok('t6a 漂移文案含留痕标记', r.out.includes('driftCount') || r.out.includes('留痕') || r.out.includes('已记录'), r.out.slice(0, 90));
let st6 = state(SID6);
ok('t6b 状态文件记 driftCount', st6 && (st6.driftCount || 0) >= 1, JSON.stringify(st6 && st6.driftCount));

// ── T7 诊断落笔 advisory ──
console.log('T7 诊断纪律');
const SID7 = SID + '-g';
const submit7 = (p) => run('UserPromptSubmit', { session_id: SID7, prompt: p });
const pedit7 = (fp) => run('PostToolUse', { session_id: SID7, tool_name: 'edit', tool_input: { file_path: fp }, cwd: HOME });
submit7('通读一下这个文件还有没有明显的问题');
r = pedit7(path.join(REPO, 'tracked.txt'));
ok('t7a 诊断+修改性写→诊断纪律注入且不拦截', r.code === 0 && r.out.includes('[诊断纪律'), `code=${r.code} ${r.out.slice(0, 70)}`);

// ── T8 路径守卫（PreToolUse 硬拦） ──
console.log('T8 路径守卫');
const SID8 = SID + '-h';
const edit8 = (fp) => run('PreToolUse', { session_id: SID8, tool_name: 'edit', tool_input: { file_path: fp, old_string: 'a', new_string: 'b' }, cwd: HOME });
const bash8 = (command, cwd) => run('PreToolUse', { session_id: SID8, tool_name: 'pwsh', tool_input: { command }, cwd: cwd || HOME });
run('UserPromptSubmit', { session_id: SID8, prompt: '修改一下README和配置，更新版本号，调整措辞' });
r = edit8(path.join(REPO, 'tracked.txt'));
ok('t8a git tracked 放行', r.code === 0 && !r.err, r.err.slice(0, 80));
r = edit8(path.join(REPO, 'untracked.txt'));
ok('t8b untracked 预存在→拦', r.code === 2 && r.err.includes('路径守卫'), `code=${r.code} ${r.err.slice(0, 80)}`);
r = edit8(path.join(REPO, 'untracked.txt'));
ok('t8c 重跑同操作放行', r.code === 0 && !r.err, r.err.slice(0, 80));
r = edit8(path.join(NONGIT, 'old.txt'));
ok('t8d 非git目录预存在→拦', r.code === 2 && r.err.includes('路径守卫'), `code=${r.code}`);
r = edit8(path.join(NONGIT, 'old.txt'));
ok('t8e 重跑放行', r.code === 0);
r = edit8(path.join(NONGIT, 'brand-new-' + TS + '.txt'));
ok('t8f 非git新文件→放行(AI创建)', r.code === 0 && !r.err, r.err.slice(0, 80));
r = bash8(`echo hi > ${W(TMPSCRATCH)}`);
ok('t8g scratch 重定向放行', r.code === 0 && !r.err, r.err.slice(0, 80));
r = bash8(`echo hi > ${W(path.join(NONGIT, 'old2.txt'))}`);
ok('t8h 非git重定向截断→拦', r.code === 2 && r.err.includes('路径守卫'), `code=${r.code}`);
r = bash8(`echo hi > ${W(path.join(NONGIT, 'old2.txt'))}`);
ok('t8i 重跑放行', r.code === 0);
r = bash8(`rm -f ${W(path.join(NONGIT, 'old.txt'))}`);
ok('t8j 非git rm→拦', r.code === 2 && r.err.includes('路径守卫'));
r = bash8(`rm -f ${W(TMPSCRATCH)}`);
ok('t8k scratch rm 放行', r.code === 0 && !r.err, r.err.slice(0, 80));
r = bash8(`Remove-Item -Recurse -Force "${W(NONGIT)}"`);
ok('t8l PS Remove-Item 非git目录→拦', r.code === 2 && r.err.includes('路径守卫'), `code=${r.code}`);

// ── T9 脚本内容扫描 ──
console.log('T9 脚本扫描');
const SID9 = SID + '-i';
const bash9 = (command) => run('PreToolUse', { session_id: SID9, tool_name: 'pwsh', tool_input: { command }, cwd: HOME });
run('UserPromptSubmit', { session_id: SID9, prompt: '修改构建脚本并跑起来验证' });
r = bash9(`node ${W(SCRATCH_SCRIPT)}`);
ok('t9a 危险内容脚本执行→拦', r.code === 2 && r.err.includes('脚本内容扫描'), `code=${r.code} ${r.err.slice(0, 80)}`);
r = bash9(`node ${W(SCRATCH_SCRIPT)}`);
ok('t9b 重跑放行', r.code === 0);

// ── T10 Bash 门禁 scratch 豁免 + 回归 ──
console.log('T10 回归');
const SIDA = SID + '-j';
const bashA = (command) => run('PreToolUse', { session_id: SIDA, tool_name: 'pwsh', tool_input: { command }, cwd: HOME });
const pshA = (command) => run('PostToolUse', { session_id: SIDA, tool_name: 'pwsh', tool_input: { command }, cwd: HOME });
run('UserPromptSubmit', { session_id: SIDA, prompt: '修改并提交代码推送发版' });
r = bashA('git push');
ok('r1 git push→拦(外发)', r.code === 2 && r.err.includes('外发'));
r = bashA('git push');
ok('r2 git push 重跑放行', r.code === 0);
r = bashA('npm publish --registry https://registry.npmjs.org');
ok('r3 npm publish→拦', r.code === 2 && r.err.includes('外发'));
r = bashA('gh api repos/x/y -X DELETE');
ok('r4 gh api 写→拦', r.code === 2 && r.err.includes('外发'));
r = bashA('git reset --hard HEAD~1');
ok('r5 reset --hard→拦', r.code === 2 && r.err.includes('状态覆盖'));
r = pshA(`sed -i 's/a/b/' ${W(path.join(REPO, 'tracked.txt'))}`);
ok('r6 sed -i tracked→提醒式不拦', r.code === 0 && r.out.includes('改类提醒'), `code=${r.code} out=${r.out.slice(0, 60)}`);
r = bashA(`cp ${W(path.join(REPO, 'tracked.txt'))} ${W(path.join(REPO, 'untracked.txt'))}`);
ok('r7 cp 覆盖 untracked→路径守卫拦', r.code === 2 && r.err.includes('路径守卫'), `code=${r.code} ${r.err.slice(0, 60)}`);
r = bashA(`mkdir -p ${W(NONGIT)}/sub && echo x > ${W(NONGIT)}/sub/f.txt && tar -xf nope.tgz -C ${W(NONGIT)}`);
ok('r8 tar 解到非空非git目录→拦', r.code === 2 && (r.err.includes('路径守卫') || r.err.includes('非空')), r.err.slice(0, 80));

// ── T-C 确认点门禁（v4C）：用户保留确认权期间，用户资产写硬拦，用户轮解除 ──
console.log('TC 确认点门禁');
const SIDC = SID + '-cf';
const submitC = (p) => run('UserPromptSubmit', { session_id: SIDC, prompt: p });
const editC = (fp) => run('PreToolUse', { session_id: SIDC, tool_name: 'edit', tool_input: { file_path: fp, old_string: 'a', new_string: 'b' }, cwd: HOME });
const bashC = (command) => run('PreToolUse', { session_id: SIDC, tool_name: 'pwsh', tool_input: { command }, cwd: HOME });
const NEWPOST = path.join(REPO, `2026-10-04-样张-${TS}.md`);

submitC('拟总标题和文件（问题本身，我再确认文件名），然后把记忆系统线先写一下我看看风格');
r = editC(NEWPOST);
ok('c1 确认点期间新建用户资产→硬拦', r.code === 2 && r.err.includes('确认点门禁'), `code=${r.code} ${r.err.slice(0, 80)}`);
r = editC(NEWPOST);
ok('c2 重跑同操作不放行(无token机制)', r.code === 2 && r.err.includes('确认点门禁'), `code=${r.code}`);
r = editC(path.join(REPO, 'tracked.txt'));
ok('c3 确认点期间改 tracked 既有文件→拦', r.code === 2 && r.err.includes('确认点门禁'), `code=${r.code} ${r.err.slice(0, 60)}`);
r = editC(path.join(os.tmpdir(), `cf-tool-${TS}.js`));
ok('c4 确认点期间 scratch 写→豁免', r.code === 0 && !r.err, r.err.slice(0, 60));
r = run('PreToolUse', { session_id: SIDC, tool_name: 'write', tool_input: { file_path: path.join(REPO, `test-confirm-${TS}.js`), content: 'x' }, cwd: HOME });
ok('c5 确认点期间 repo 内工具脚本命名→豁免(tool)', r.code === 0 && !r.err, r.err.slice(0, 60));
r = bashC(`echo hi > ${W(NEWPOST)}`);
ok('c6 确认点期间重定向写用户区新文件→拦(不依赖exists)', r.code === 2 && r.err.includes('确认点门禁'), `code=${r.code}`);
r = bashC(`cp ${W(path.join(REPO, 'tracked.txt'))} ${W(NEWPOST)}`);
ok('c7 确认点期间 cp 到用户区→拦', r.code === 2 && r.err.includes('确认点门禁'), `code=${r.code}`);
r = bashC(`echo hi > ${W(TMPSCRATCH)}`);
ok('c8 确认点期间 scratch 重定向→豁免', r.code === 0 && !r.err, r.err.slice(0, 60));

submitC('User has answered your questions: "x"="y"');
r = editC(NEWPOST);
ok('c9 问答式回应不清除pending(tool_result形态)', r.code === 2 && r.err.includes('确认点门禁'), `code=${r.code}`);

submitC('可以，就这个文件名');
r = editC(NEWPOST);
ok('c10 用户轮到达→清除→放行', r.code === 0 && !r.err, r.err.slice(0, 80));

run('PreToolUse', { session_id: SIDC, tool_name: 'ask_user_question', tool_input: { questions: [{ question: '系列（一）装什么？（系列名按第一题选定，文件名我组装后你再确认）', options: [] }] } });
r = editC(path.join(REPO, `ask-promise-${TS}.md`));
ok('c11 AI问题文本含"你再确认"承诺→落笔拦', r.code === 2 && r.err.includes('确认点门禁'), `code=${r.code} ${r.err.slice(0, 60)}`);
submitC('看到了，没问题');
r = editC(path.join(REPO, `ask-promise-${TS}.md`));
ok('c12 用户轮后AI承诺门解除', r.code === 0 && !r.err, r.err.slice(0, 60));

const SIDD = SID + '-cf2';
run('UserPromptSubmit', { session_id: SIDD, prompt: '修改一下README更新内容，改完发我' });
r = run('PreToolUse', { session_id: SIDD, tool_name: 'edit', tool_input: { file_path: path.join(REPO, 'tracked.txt'), old_string: 'a', new_string: 'b' }, cwd: HOME });
ok('c13 无确认措辞→不走确认门', r.code === 0 && !r.err.includes('确认点门禁'), `code=${r.code}`);

// ── 清理（先于 M1，M1 用独立目录） ──
for (const d of [NONGIT, REPO]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
for (const f of [SCRATCH_SCRIPT, TMPSCRATCH]) { try { fs.rmSync(f, { force: true }); } catch {} }
try { clearState(SID); } catch {}
for (const s of [SID, SID + '-c', SID + '-e', SID + '-f', SID + '-g', SID + '-h', SID + '-i', SID + '-j', SID + '-cf', SID + '-cf2']) {
  try { clearState(s); } catch {}
}

// ── M1 完成断言证据门 + 翻转对账（v4B）：合成 DSH sessions 目录 ──
// Stop 读 <root>/--slug--/session-<sid>/session.v4.jsonl[.zstd]；用 ASKFIRST_DSH_SESSIONS_DIR 指到沙箱。
console.log('M1 完成断言证据门');
const M1ENV = { ASKFIRST_DSH_SESSIONS_DIR: M1DIR };
const um = (text, extra) => JSON.stringify(Object.assign({ type: 'user/message', seq: 1, time: Date.now(), data: { role: 'user', id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'q' }] } }, extra || {}));
let seqc = 1;
const am = (blocks) => JSON.stringify({ type: 'assistant/message', seq: ++seqc, time: Date.now(), data: { turn: 1, step: 1, message: { role: 'assistant', content: blocks }, usage: {}, stream: false } });
const tc = (name, argsObj) => JSON.stringify({ type: 'tool/call', seq: ++seqc, time: Date.now(), data: { turn: 1, step: 1, callId: 'c' + seqc, name, arguments: JSON.stringify(argsObj) } });
const txt = (t) => am([{ type: 'text', text: t }]);
const thk = (t) => am([{ type: 'reasoning', text: t }]);
const m1stop = (sid, env) => run('Stop', { session_id: sid, cwd: HOME }, env || M1ENV);
const mk = (name, lines, zstdCompress) => {
  const dir = path.join(M1DIR, '--gatetest--', 'session-' + name);
  fs.mkdirSync(dir, { recursive: true });
  const body = lines.map((l) => l).join('\n') + '\n';
  const file = path.join(dir, zstdCompress ? 'session.v4.jsonl.zstd' : 'session.v4.jsonl');
  fs.writeFileSync(file, zstdCompress ? zlib.zstdCompressSync(Buffer.from(body)) : body);
};

const SIDM = SID + '-m1';
seqc = 1;
mk(SIDM, [um(), txt('中间叙述一段'), txt('收工，修好了。问题的根源在 X，已按方案处理。')]);
let rm1 = m1stop(SIDM);
ok('m1a 纯断言→steer 恰一次', rm1.code === 2 && rm1.err.includes('M1 完成断言证据门') && rm1.err.includes('修好'), `code=${rm1.code} ${rm1.err.slice(0, 90)}`);
rm1 = m1stop(SIDM);
ok('m1b 同会话第二次→静默(doneGate)', rm1.code === 0 && !rm1.err && !rm1.out, (rm1.err + rm1.out).slice(0, 60));

const SIDM2 = SID + '-m1b';
seqc = 1;
mk(SIDM2, [um(), txt('可能修好了，你试试看。')]);
rm1 = m1stop(SIDM2);
ok('m1c 对冲词→不触发', rm1.code === 0 && !rm1.err, rm1.err.slice(0, 60));

const SIDM3 = SID + '-m1c';
seqc = 1;
mk(SIDM3, [um(), txt('说明如下：\n```\n修好了\n```\n以上是引用。')]);
rm1 = m1stop(SIDM3);
ok('m1d 代码块内→不触发', rm1.code === 0 && !rm1.err, rm1.err.slice(0, 60));

const SIDM4 = SID + '-m1d';
seqc = 1;
mk(SIDM4, [um(), tc('pwsh', { command: 'npm test 2>&1 | tail -5' }), txt('测试全部通过，修好了。')]);
rm1 = m1stop(SIDM4);
ok('m1e 同轮含验证命令→豁免', rm1.code === 0 && !rm1.err, rm1.err.slice(0, 60));

const SIDM5 = SID + '-m1e';
seqc = 1;
mk(SIDM5, [um(), txt('前面说过修好了。'), txt('另外补充一点背景说明。')]);
rm1 = m1stop(SIDM5);
ok('m1f 断言在非末段→不触发', rm1.code === 0 && !rm1.err, rm1.err.slice(0, 60));

// m1g: zstd 压缩会话文件（真实帧结构——每行一帧）
const SIDM7 = SID + '-m1g';
{
  const dir = path.join(M1DIR, '--gatetest--', 'session-' + SIDM7);
  fs.mkdirSync(dir, { recursive: true });
  const lines = [um(), txt('搞定了，全部弄好了。')];
  const out = lines.map((l) => zlib.zstdCompressSync(Buffer.from(l + '\n')));
  fs.writeFileSync(path.join(dir, 'session.v4.jsonl.zstd'), Buffer.concat(out));
}
rm1 = m1stop(SIDM7);
ok('m1g zstd 多帧会话文件→M1 正常触发', rm1.code === 2 && rm1.err.includes('M1'), `code=${rm1.code} ${rm1.err.slice(0, 60)}`);

// m1h: 有任务态的会话 M1 独立触发（不与 confirmed 混）
const SIDM6 = SID + '-m1f';
seqc = 1;
mk(SIDM6, [um(), txt('搞定了一切。')]);
run('UserPromptSubmit', { session_id: SIDM6, prompt: '修改一下README更新内容' });
rm1 = m1stop(SIDM6);
ok('m1h 有任务态的会话→M1 仍独立触发', rm1.code === 2 && rm1.err.includes('M1'), rm1.err.slice(0, 60));

// f1: 翻转对账（reasoning 块高密度翻转且未反问）
const SIDF = SID + '-flip';
seqc = 1;
mk(SIDF, [um(), thk('等等，这样不对，其实应该等等再看看，不对，等等等等'.repeat(3))]);
rm1 = m1stop(SIDF);
ok('f1 高翻转未反问→FLIP steer', rm1.code === 2 && rm1.err.includes('翻转'), `code=${rm1.code} ${rm1.err.slice(0, 60)}`);

for (const s of [SID + '-m1', SID + '-m1b', SID + '-m1c', SID + '-m1d', SID + '-m1e', SID + '-m1f', SID + '-m1g', SID + '-flip']) {
  try { clearState(s); } catch {}
}
try { fs.rmSync(M1DIR, { recursive: true, force: true }); } catch {}

// ── v6: ambient 前缀与用户话同轮（DSH 首轮把 hirame/AGENTS 快照拼进 prompt） ──
const NL = String.fromCharCode(10);
const v6submit = (p) => run('UserPromptSubmit', { session_id: SID + '-v6', prompt: p });
const HIRAME = ['Memory (dsh-hirame)', '', 'Memory root: `C:\\Users\\demo\\mem`', '', '`MEMORY.md` index:', '- [x](x.md) — y'].join(NL);
{
  const r = v6submit(HIRAME + NL + NL + '把这个模块重构成独立包');
  ok('v6a hirame 快照在前→用户话仍注入', r.out.includes('本任务分类='), r.out.slice(0, 80));
  const r2 = v6submit('<system-reminder>' + NL + 'foo' + NL + '</system-reminder>' + NL + NL + '再帮我删掉旧配置');
  ok('v6b system-reminder 在前→用户话仍注入', r2.out.includes('本任务分类='), r2.out.slice(0, 80));
  const r3 = v6submit('Current runtime context. This snapshot supersedes earlier.' + NL + NL + '帮我改一下这个函数');
  ok('v6c runtime-context 在前→用户话仍注入', r3.out.includes('本任务分类='), r3.out.slice(0, 80));
  const r4 = v6submit('A skill is a reusable set of task-specific instructions.' + NL + NL + '帮我改一下这个函数');
  ok('v6d skill-catalog 在前→用户话仍注入', r4.out.includes('本任务分类='), r4.out.slice(0, 80));
  const r5 = v6submit(HIRAME);
  ok('v6e 纯 ambient 无用户话→不注入', !r5.out.includes('本任务分类='), r5.out.slice(0, 80));
  const r6 = v6submit('把这个模块重构成独立包');
  ok('v6f 无前缀正常分类（回归）', r6.out.includes('本任务分类='), r6.out.slice(0, 80));
}

// ── v5: 计划态 / 描述 / 信封（dsh 镜像） ──
{
  const r1 = submit('我计划全局移除zcode-wallet，先跑一下看看现状再说');
  ok('v5a 计划态注入', r1.out.includes('本任务分类=计划'), r1.out.slice(0, 60));
  ok('v5b 信封不注入', !submit('This session is being continued from a previous conversation that ran out of context. Continue the encoder fix.').out.includes('本任务分类'));
  const r3 = submit('C:\\Users\\demo>ssh cvlab "find /x -type f" 输出如下，帮我看看');
  ok('v5c 粘贴不注入trio', !r3.out.includes('本任务分类='), r3.out.slice(0, 60));
}

// ── v6(D): 状态目录选址（DSH 沙箱只放行工作区 + 临时目录；~/.dsh 只有 RX） ──
{
  const SID7 = SID + '-v6d';
  const WS7 = path.join(HOME, `.dsh-gate-test-ws-${TS}`);
  fs.mkdirSync(WS7, { recursive: true });
  try {
    // v6d-a: 有 cwd 时状态落工作区内，而不是 ~/.dsh or tmp
    run('UserPromptSubmit', { session_id: SID7, prompt: '把这个模块重构成独立包并更新文档', cwd: WS7 });
    const inWs = fs.existsSync(path.join(WS7, '.dsh-hooks-state', `zcode-askfirst-${SID7}.json`));
    ok('v6d-a 状态落工作区 .dsh-hooks-state', inWs);
    // v6d-b: 状态文件自带 stateDir 标记（跨进程复用同一目录）
    const st7 = inWs ? JSON.parse(fs.readFileSync(path.join(WS7, '.dsh-hooks-state', `zcode-askfirst-${SID7}.json`), 'utf8')) : null;
    ok('v6d-b 状态记录 stateDir', st7 && st7.stateDir === path.join(WS7, '.dsh-hooks-state'), JSON.stringify(st7 && st7.stateDir));
    // v6d-c: 后续调用不带 cwd 也能读到同一份状态（不会另起炉灶）
    run('PreToolUse', { session_id: SID7, tool_name: 'edit', tool_input: { file_path: path.join(WS7, 'new-' + TS + '.txt') } });
    const st7b = JSON.parse(fs.readFileSync(path.join(WS7, '.dsh-hooks-state', `zcode-askfirst-${SID7}.json`), 'utf8'));
    ok('v6d-c 无 cwd 调用复用同一目录', st7b.memWroteEdit === true, JSON.stringify(st7b.memWroteEdit));
    // v6d-d: 写不进去时不留脏文件/不抛错（scratch 目录恒可写，这里验证无 stderr）
    const r7 = run('UserPromptSubmit', { session_id: SID7, prompt: '改成独立包', cwd: WS7 });
    ok('v6d-d 状态写无 stderr', !/state write failed/.test(r7.err), r7.err.slice(0, 80));
    try { fs.rmSync(WS7, { recursive: true, force: true }); } catch {}
  } catch (e) {
    ok('v6d 状态目录选址', false, String(e && e.message));
  }
}

// ── v6(D): 记忆写入提醒（hirame 只有注入钩子，写不写全凭模型自觉） ──
{
  const SIDM = SID + '-mem';
  const MROOT = path.join(HOME, '.zcode', 'cli', 'memories', 'projects', `gatetest-mem-${TS}`, 'memory');
  const WS8 = path.join(HOME, `.dsh-gate-test-memws-${TS}`);
  fs.mkdirSync(WS8, { recursive: true });
  const stopRun = (sid, extra) => run('Stop', { session_id: sid, cwd: WS8, ...extra });
  // 造一个会话日志，供 Stop 侧读尾
  const sdir = path.join(os.tmpdir(), `gatetest-stop-${TS}`);
  fs.mkdirSync(sdir, { recursive: true });
  const logf = path.join(sdir, 'session.v4.jsonl');
  fs.writeFileSync(logf, [
    JSON.stringify({ type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '改成独立包' }] } }),
    JSON.stringify({ type: 'assistant/message', seq: 2, data: { message: { content: [{ type: 'text', text: '改完了，说明如下。' }] } } }),
  ].join('\n'));
  const origSessions = process.env.ASKFIRST_DSH_SESSIONS_DIR;
  // 直接验证消息常量存在 + 触发条件：无记忆操作且有落笔 -> 提醒
  const src = fs.readFileSync(HOOK, 'utf8');
  ok('v6d-e 记忆提醒文案存在', /ask-first 记忆写入/.test(src));
  ok('v6d-f 记忆提醒每会话一次(sid 维度 state)', /st\.memNotified/.test(src));
  ok('v6d-g 有落笔才提醒(纯读轮豁免)', /didWork/.test(src) && /memTouched/.test(src));
  try { fs.rmSync(WS8, { recursive: true, force: true }); fs.rmSync(sdir, { recursive: true, force: true }); } catch {}
  if (origSessions !== undefined) process.env.ASKFIRST_DSH_SESSIONS_DIR = origSessions;
}

console.log(`\n==== ${pass} pass, ${fail} fail ====`);
if (failures.length) { console.log('FAILURES:'); for (const f of failures) console.log(' -', f); process.exit(1); }
