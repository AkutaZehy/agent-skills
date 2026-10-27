// ask-first 协议 v7 测试台（覆盖 gate 批次 v4C / v5 / v6 / v7-audit；v8a…v8l 为历史用例名）。用法: node test-gate.js [被测hook路径]
// 每次运行构建独立沙箱(时间戳 sid/目录)，断言 {exit, stdout, stderr}。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = process.argv[2] || path.join(__dirname, 'askfirst-gate.js');
const HOME = process.env.USERPROFILE || process.env.HOME;
const TS = Date.now();
const SID = `gatetest-${TS}`;
const NONGIT = path.join(HOME, `.zcode-gate-test-nongit-${TS}`);
const REPO = path.join(HOME, `.zcode-gate-test-repo-${TS}`);
const SCRATCH_SCRIPT = path.join(HOME, '.zcode', `test-gate-scan-${TS}.js`);
const TMPSCRATCH = path.join(os.tmpdir(), `gatetest-tmp-${TS}.txt`);

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; failures.push(name + (extra ? ' :: ' + extra : '')); console.log('  FAIL', name, extra || ''); }
}
function run(event, payload) {
  const r = spawnSync(process.execPath, [HOOK, event], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 8000,
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
const submit = (prompt) => run('UserPromptSubmit', { sessionId: SID, prompt });
const edit = (fp) => run('PreToolUse', { sessionId: SID, toolName: 'Edit', toolInput: { file_path: fp, old_string: 'a', new_string: 'b' }, cwd: HOME });
const bash = (command, cwd) => run('PreToolUse', { sessionId: SID, toolName: 'Bash', toolInput: { command }, cwd: cwd || HOME });
const state = () => { try { return JSON.parse(fs.readFileSync(path.join(HOME || process.env.USERPROFILE || os.homedir(), '.zcode', 'hooks', 'state', `zcode-askfirst-${SID}.json`), 'utf8')); } catch { return null; } };
const W = (p) => String(p);

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
try { fs.rmSync(path.join(HOME || process.env.USERPROFILE || os.homedir(), '.zcode', 'hooks', 'state', `zcode-askfirst-${SID}.json`), { force: true }); } catch {}

console.log(`sandbox: sid=${SID}\n  nongit=${NONGIT}\n  repo=${REPO}\n  scratchScript=${SCRATCH_SCRIPT}`);

// ── T1 ambient 不重置任务状态 ──
console.log('T1 ambient');
let r = submit('调研一下GLM的缓存计费是什么机制');            // 检索
ok('t1a 常规提示无崩溃', true);
r = submit('<in-app-browser-context source="ambient-ui-state"> blah'); 
r = submit('Perform a web search for the query: test ambient');
const st1 = state();
ok('t1b ambient 后类型保持检索', st1 && st1.type === '检索', JSON.stringify(st1 && st1.type));
r = edit(path.join(REPO, 'tracked.txt'));
ok('t1c ambient 后漂移仍一次性触发', r.out.includes('[类型漂移'), r.out.slice(0, 80));
r = edit(path.join(REPO, 'tracked.txt'));
ok('t1d 第二次落笔不再触发', !r.out.includes('[类型漂移') && r.code === 0);

// ── T2 中文续接不重置 ──
console.log('T2 续接');
const SID2 = SID + '-c';
const submit2 = (p) => run('UserPromptSubmit', { sessionId: SID2, prompt: p });
const edit2 = (fp) => run('PreToolUse', { sessionId: SID2, toolName: 'Edit', toolInput: { file_path: fp, old_string: 'a', new_string: 'b' }, cwd: HOME });
submit2('检查一下这个项目的代码有没有明显的问题');
submit2('继续');
submit2('修');
let st2 = null; try { st2 = JSON.parse(fs.readFileSync(path.join(HOME || process.env.USERPROFILE || os.homedir(), '.zcode', 'hooks', 'state', `zcode-askfirst-${SID2}.json`), 'utf8')); } catch {}
ok('t2a 续接后类型保持诊断', st2 && st2.type === '诊断', JSON.stringify(st2 && st2.type));
r = edit2(path.join(REPO, 'tracked.txt'));
ok('t2b 诊断任务落笔收诊断纪律(非漂移)', r.out.includes('[诊断纪律'), r.out.slice(0, 80));

// ── T3 记忆目录写静默 ──
console.log('T3 记忆目录');
r = submit('检查一下记忆文件现状');
r = edit(path.join(HOME, '.zcode', 'cli', 'memories', 'projects', 'testproj-0000000000000000', 'memory', 'MEMORY.md'));
ok('t3a 记忆写零输出零拦截', r.code === 0 && !r.out && !r.err, r.out.slice(0, 60) + r.err.slice(0, 60));

// ── T4 unknown 首笔中性对账 ──
console.log('T4 unknown');
submit('前端界面？');
r = edit(path.join(REPO, 'tracked.txt'));
ok('t4a unknown 首笔收中性对账', r.out.includes('[三件套对账') || (r.out.includes('unknown') && r.code === 0), r.out.slice(0, 90));
r = edit(path.join(REPO, 'tracked.txt'));
ok('t4b 第二次不再触发', !r.out.includes('[三件套对账') && r.code === 0);

// ── T5 检查不再判检索 ──
console.log('T5 检查分类');
const SID5 = SID + '-e';
run('UserPromptSubmit', { sessionId: SID5, prompt: '检查一下现在zcode wallet这个skill怎么写的，我感觉可能有过时的地方' });
let st5 = null; try { st5 = JSON.parse(fs.readFileSync(path.join(HOME || process.env.USERPROFILE || os.homedir(), '.zcode', 'hooks', 'state', `zcode-askfirst-${SID5}.json`), 'utf8')); } catch {}
ok('t5a 检查一下→诊断', st5 && st5.type === '诊断', JSON.stringify(st5 && st5.type));

// ── T6 真漂移留痕 ──
console.log('T6 漂移留痕');
const SID6 = SID + '-f';
const submit6 = (p) => run('UserPromptSubmit', { sessionId: SID6, prompt: p });
const edit6 = (fp) => run('PreToolUse', { sessionId: SID6, toolName: 'Edit', toolInput: { file_path: fp, old_string: 'a', new_string: 'b' }, cwd: HOME });
submit6('调研一下当前市场的竞品有哪些');
r = edit6(path.join(REPO, 'tracked.txt'));
ok('t6a 漂移文案含留痕标记', r.out.includes('driftCount') || r.out.includes('留痕') || r.out.includes('已记录'), r.out.slice(0, 90));
let st6 = null; try { st6 = JSON.parse(fs.readFileSync(path.join(HOME || process.env.USERPROFILE || os.homedir(), '.zcode', 'hooks', 'state', `zcode-askfirst-${SID6}.json`), 'utf8')); } catch {}
ok('t6b 状态文件记 driftCount', st6 && (st6.driftCount || 0) >= 1, JSON.stringify(st6 && st6.driftCount));

// ── T7 诊断落笔 advisory ──
console.log('T7 诊断纪律');
const SID7 = SID + '-g';
const submit7 = (p) => run('UserPromptSubmit', { sessionId: SID7, prompt: p });
const edit7 = (fp) => run('PreToolUse', { sessionId: SID7, toolName: 'Edit', toolInput: { file_path: fp, old_string: 'a', new_string: 'b' }, cwd: HOME });
submit7('通读一下这个文件还有没有明显的问题');
r = edit7(path.join(REPO, 'tracked.txt'));
ok('t7a 诊断+修改性写→诊断纪律注入且不拦截', r.code === 0 && r.out.includes('[诊断纪律'), `code=${r.code} ${r.out.slice(0, 70)}`);

// ── T8 路径守卫 ──
console.log('T8 路径守卫');
const SID8 = SID + '-h';
const edit8 = (fp) => run('PreToolUse', { sessionId: SID8, toolName: 'Edit', toolInput: { file_path: fp, old_string: 'a', new_string: 'b' }, cwd: HOME });
const bash8 = (command, cwd) => run('PreToolUse', { sessionId: SID8, toolName: 'Bash', toolInput: { command }, cwd: cwd || HOME });
run('UserPromptSubmit', { sessionId: SID8, prompt: '修改一下README和配置，更新版本号，调整措辞' });
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
r = bash8(`echo hi > ${W(TMPSCRATCH).replace(/\\/g, '/')}`);
ok('t8g scratch 重定向放行', r.code === 0 && !r.err, r.err.slice(0, 80));
r = bash8(`echo hi > ${W(path.join(NONGIT, 'old2.txt')).replace(/\\/g, '/')}`);
ok('t8h 非git重定向截断→拦', r.code === 2 && r.err.includes('路径守卫'), `code=${r.code}`);
r = bash8(`echo hi > ${W(path.join(NONGIT, 'old2.txt')).replace(/\\/g, '/')}`);
ok('t8i 重跑放行', r.code === 0);
r = bash8(`rm -f ${W(path.join(NONGIT, 'old.txt')).replace(/\\/g, '/')}`);
ok('t8j 非git rm→拦', r.code === 2 && r.err.includes('路径守卫'));
r = bash8(`rm -f ${W(TMPSCRATCH).replace(/\\/g, '/')}`);
ok('t8k scratch rm 放行', r.code === 0 && !r.err, r.err.slice(0, 80));

// ── T9 脚本内容扫描 ──
console.log('T9 脚本扫描');
const SID9 = SID + '-i';
const bash9 = (command) => run('PreToolUse', { sessionId: SID9, toolName: 'Bash', toolInput: { command }, cwd: HOME });
run('UserPromptSubmit', { sessionId: SID9, prompt: '修改构建脚本并跑起来验证' });
r = bash9(`node ${W(SCRATCH_SCRIPT).replace(/\\/g, '/')}`);
ok('t9a 危险内容脚本执行→拦', r.code === 2 && r.err.includes('脚本内容扫描'), `code=${r.code} ${r.err.slice(0, 80)}`);
r = bash9(`node ${W(SCRATCH_SCRIPT).replace(/\\/g, '/')}`);
ok('t9b 重跑放行', r.code === 0);

// ── T10 Bash 门禁 scratch 豁免 + 回归 ──
console.log('T10 回归');
const SIDA = SID + '-j';
const bashA = (command) => run('PreToolUse', { sessionId: SIDA, toolName: 'Bash', toolInput: { command }, cwd: HOME });
run('UserPromptSubmit', { sessionId: SIDA, prompt: '修改并提交代码推送发版' });
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
r = bashA(`sed -i 's/a/b/' ${W(path.join(REPO, 'tracked.txt')).replace(/\\/g, '/')}`);
ok('r6 sed -i tracked→提醒式不拦', r.code === 0 && r.out.includes('改类提醒'), `code=${r.code} out=${r.out.slice(0, 60)}`);
r = bashA(`cp ${W(path.join(REPO, 'tracked.txt')).replace(/\\/g, '/')} ${W(path.join(REPO, 'untracked.txt')).replace(/\\/g, '/')}`);
ok('r7 cp 覆盖 untracked→路径守卫拦', r.code === 2 && r.err.includes('路径守卫'), `code=${r.code} ${r.err.slice(0, 60)}`);
r = bashA(`mkdir -p ${NONGIT.replace(/\\/g, '/')}/sub && echo x > ${NONGIT.replace(/\\/g, '/')}/sub/f.txt && tar -xf nope.tgz -C ${NONGIT.replace(/\\/g, '/')}`);
ok('r8 tar 解到非空非git目录→拦', r.code === 2 && (r.err.includes('路径守卫') || r.err.includes('非空')), r.err.slice(0, 80));

// ── T-C 确认点门禁（v4C）：用户保留确认权期间，用户资产写硬拦，用户轮解除 ──
console.log('TC 确认点门禁');
const SIDC = SID + '-cf';
const submitC = (p) => run('UserPromptSubmit', { sessionId: SIDC, prompt: p });
const editC = (fp) => run('PreToolUse', { sessionId: SIDC, toolName: 'Edit', toolInput: { file_path: fp, old_string: 'a', new_string: 'b' }, cwd: HOME });
const bashC = (command) => run('PreToolUse', { sessionId: SIDC, toolName: 'Bash', toolInput: { command }, cwd: HOME });
const NEWPOST = path.join(REPO, `2026-10-04-样张-${TS}.md`); // git 仓库内新建文件：路径守卫放行面，只剩确认点门

submitC('拟总标题和文件（问题本身，我再确认文件名），然后把记忆系统线先写一下我看看风格');
r = editC(NEWPOST);
ok('c1 确认点期间新建用户资产→硬拦', r.code === 2 && r.err.includes('确认点门禁'), `code=${r.code} ${r.err.slice(0, 80)}`);
r = editC(NEWPOST);
ok('c2 重跑同操作不放行(无token机制)', r.code === 2 && r.err.includes('确认点门禁'), `code=${r.code}`);
r = editC(path.join(REPO, 'tracked.txt'));
ok('c3 确认点期间改 tracked 既有文件→拦(与路径守卫并存)', r.code === 2 && r.err.includes('确认点门禁'), `code=${r.code} ${r.err.slice(0, 60)}`);
r = editC(path.join(os.tmpdir(), `cf-tool-${TS}.js`));
ok('c4 确认点期间 scratch 写→豁免', r.code === 0 && !r.err, r.err.slice(0, 60));
r = run('PreToolUse', { sessionId: SIDC, toolName: 'Write', toolInput: { file_path: path.join(REPO, `test-confirm-${TS}.js`), content: 'x' }, cwd: HOME });
ok('c5 确认点期间 repo 内工具脚本命名→豁免(tool)', r.code === 0 && !r.err, r.err.slice(0, 60));
r = bashC(`echo hi > ${W(NEWPOST).replace(/\\/g, '/')}`);
ok('c6 确认点期间重定向写用户区新文件→拦(不依赖exists)', r.code === 2 && r.err.includes('确认点门禁'), `code=${r.code}`);
r = bashC(`cp ${W(path.join(REPO, 'tracked.txt')).replace(/\\/g, '/')} ${W(NEWPOST).replace(/\\/g, '/')}`);
ok('c7 确认点期间 cp 到用户区→拦', r.code === 2 && r.err.includes('确认点门禁'), `code=${r.code}`);
r = bashC(`echo hi > ${W(TMPSCRATCH).replace(/\\/g, '/')}`);
ok('c8 确认点期间 scratch 重定向→豁免', r.code === 0 && !r.err, r.err.slice(0, 60));

submitC('User has answered your questions: "x"="y"');
r = editC(NEWPOST);
ok('c9 问答式回应不清除pending(tool_result形态)', r.code === 2 && r.err.includes('确认点门禁'), `code=${r.code}`);

submitC('可以，就这个文件名');
r = editC(NEWPOST);
ok('c10 用户轮到达→清除→放行', r.code === 0 && !r.err, r.err.slice(0, 80));

// AI 问题文本里的确认承诺也被状态化
run('PreToolUse', { sessionId: SIDC, toolName: 'AskUserQuestion', toolInput: { questions: [{ question: '系列（一）装什么？（系列名按第一题选定，文件名我组装后你再确认）', options: [] }] } });
r = editC(path.join(REPO, `ask-promise-${TS}.md`));
ok('c11 AI问题文本含"你再确认"承诺→落笔拦', r.code === 2 && r.err.includes('确认点门禁'), `code=${r.code} ${r.err.slice(0, 60)}`);
submitC('看到了，没问题');
r = editC(path.join(REPO, `ask-promise-${TS}.md`));
ok('c12 用户轮后AI承诺门解除', r.code === 0 && !r.err, r.err.slice(0, 60));

// 无确认点任务不受影响（回归）
const SIDD = SID + '-cf2';
run('UserPromptSubmit', { sessionId: SIDD, prompt: '修改一下README更新内容，改完发我' });
r = run('PreToolUse', { sessionId: SIDD, toolName: 'Edit', toolInput: { file_path: path.join(REPO, 'tracked.txt'), old_string: 'a', new_string: 'b' }, cwd: HOME });
ok('c13 无确认措辞→不走确认门', r.code === 0 && !r.err.includes('确认点门禁'), `code=${r.code}`);

// ── 清理 ──
for (const d of [NONGIT, REPO]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
try { fs.rmSync(SCRATCH_SCRIPT, { force: true }); } catch {}
try { fs.rmSync(TMPSCRATCH, { force: true }); } catch {}
for (const s of [SID, SID + '-c', SID + '-e', SID + '-f', SID + '-g', SID + '-h', SID + '-i', SID + '-j', SID + '-cf', SID + '-cf2']) {
  try { fs.rmSync(path.join(HOME || process.env.USERPROFILE || os.homedir(), '.zcode', 'hooks', 'state', `zcode-askfirst-${s}.json`), { force: true }); } catch {}
}

// ── M1 完成断言证据门（v4B）：需要合成 rollout ──
// onStop 读 ROLLOUT_DIR/model-io-sess-<sid>.jsonl；用 ASKFIRST_ROLLOUT_DIR 指到沙箱。
console.log('M1 完成断言证据门');
const M1DIR = path.join(os.tmpdir(), `gatetest-m1-${TS}`);
fs.mkdirSync(M1DIR, { recursive: true });
const m1line = (text, bash) => JSON.stringify({
  completedAt: new Date().toISOString(),
  request: { body: { messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }] } },
  response: { text, reasoningText: 'r'.repeat(60), toolCalls: bash ? [{ id: 'x1', name: 'Bash', input: { command: bash } }] : [] },
});
const m1stop = (sid) => {
  const r = spawnSync(process.execPath, [HOOK, 'Stop'], {
    input: JSON.stringify({ sessionId: sid }), encoding: 'utf8', timeout: 8000,
    env: { ...process.env, ASKFIRST_ROLLOUT_DIR: M1DIR },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
};
const mk = (name, lines) => { fs.writeFileSync(path.join(M1DIR, `model-io-sess_${name}.jsonl`), lines.join('\n') + '\n'); };

const SIDM = SID + '-m1';
mk(SIDM, [
  m1line('中间叙述一段'),
  m1line('收工，修好了。问题的根源在 X，已按方案处理。'),
]);
let rm1 = m1stop(SIDM);
ok('m1a 纯断言→注入恰一次', rm1.code === 0 && rm1.out.includes('M1 完成断言证据门') && rm1.out.includes('修好'), rm1.out.slice(0, 90));
rm1 = m1stop(SIDM);
ok('m1b 同会话第二次→静默(doneGate)', rm1.code === 0 && !rm1.out, rm1.out.slice(0, 60));

const SIDM2 = SID + '-m1b';
mk(SIDM2, [m1line('可能修好了，你试试看。')]);
rm1 = m1stop(SIDM2);
ok('m1c 对冲词→不触发', rm1.code === 0 && !rm1.out, rm1.out.slice(0, 60));

const SIDM3 = SID + '-m1c';
mk(SIDM3, [m1line('说明如下：\n```\n修好了\n```\n以上是引用。')]);
rm1 = m1stop(SIDM3);
ok('m1d 代码块内→不触发', rm1.code === 0 && !rm1.out, rm1.out.slice(0, 60));

const SIDM4 = SID + '-m1d';
mk(SIDM4, [
  m1line('跑一下测试', 'npm test 2>&1 | tail -5'),
  m1line('测试全部通过，修好了。'),
]);
rm1 = m1stop(SIDM4);
ok('m1e 同轮含验证命令→噪声闸免注入', rm1.code === 0 && !rm1.out, rm1.out.slice(0, 60));

const SIDM5 = SID + '-m1e';
mk(SIDM5, [
  m1line('前面说过修好了。'),
  m1line('另外补充一点背景说明。'),
]);
rm1 = m1stop(SIDM5);
ok('m1f 断言在非末段→不触发', rm1.code === 0 && !rm1.out, rm1.out.slice(0, 60));

// M1 用独立状态键，不与 confirmed 混用：构造一个 confirmed 非空的会话再触发
const SIDM6 = SID + '-m1f';
mk(SIDM6, [m1line('搞定了一切。')]);
run('UserPromptSubmit', { sessionId: SIDM6, prompt: '修改一下README更新内容' });
rm1 = m1stop(SIDM6);
ok('m1g 有任务态的会话→M1 仍独立触发', rm1.code === 0 && rm1.out.includes('M1'), rm1.out.slice(0, 60));
try { fs.rmSync(M1DIR, { recursive: true, force: true }); } catch {}

// ── v5: 计划态 / 描述 / 信封 / 交叉确认 ──
{
  const r1 = submit('我计划全局移除zcode-wallet，先跑一下看看现状再说');
  ok('v5a 计划态注入+标签', r1.out.includes('本任务分类=计划'), r1.out.slice(0, 60));
  ok('v5b 计划态入state', state() && state().type === '计划', JSON.stringify(state()));
  ok('v5c 我可能需要→计划', submit('我可能需要卸载这个驱动，先问下影响').out.includes('本任务分类=计划'));
  ok('v5d 准备把→计划', submit('准备把FRP加上，先看看锚度分布如何？').out.includes('本任务分类=计划'));
  ok('v5e 叙事"我准备"不误判', !submit('我准备环境变量的时候报错了，排查一下').out.includes('本任务分类=计划'));
}
{
  submit('帮我修改这个文件的编码格式，改成UTF8'); // 置 type=改
  const before = state().type;
  const r = submit('This session is being continued from a previous conversation that ran out of context. Continue the encoder fix.');
  ok('v5f 信封不注入', !r.out.includes('本任务分类'), r.out.slice(0, 60));
  ok('v5g 信封不重置state', state().type === before, JSON.stringify(state()));
}
{
  const r = submit('C:\\Users\\demo>ssh cvlab "find /x -type f -size +500M" 输出如下，帮我看看哪些能删');
  ok('v5h 终端粘贴→描述', state().type === '描述', JSON.stringify(state()));
  // v7-audit 起：描述（粘贴）轮不注入全量 trio，但收轻提醒（历史裸奔率最高的桶）
  ok('v5i 描述不注入全量trio', !r.out.includes('[开工三件套]'), r.out.slice(0, 60));
  ok('v5i2 描述收轻提醒', r.out.includes('开工三件套·轻'), r.out.slice(0, 60));
}
{
  submit('我打算清理这个模块，先聊聊思路'); // 计划
  const r = edit(W(path.join(REPO, 'tracked.txt')));
  ok('v5j 计划态落笔advisory', (r.out + r.err).includes('计划态'), (r.out + r.err).slice(0, 80));
}
{
  submit('chenqian@lthpc:/data$ ls -la');
  const r = edit(W(path.join(REPO, 'tracked.txt')));
  ok('v5k 描述落笔漂移', (r.out + r.err).includes('漂移'), (r.out + r.err).slice(0, 80));
}

// ── v7-audit: unknown/读/检索轻提醒（B1）+ 最小完备集文案（B2）+ 功能文卫生 advisory（A2）；v8a…v8l 为历史用例名 ──
{
  const r = submit('调研一下当前各家模型的缓存计费机制'); // 检索
  ok('v8a 检索轮收轻提醒', r.out.includes('开工三件套·轻') && r.out.includes('本任务分类=检索'), r.out.slice(0, 80));
  const r2 = submit('前端界面？'); // unknown
  ok('v8b unknown 轮收轻提醒', r2.out.includes('开工三件套·轻') && r2.out.includes('unknown'), r2.out.slice(0, 80));
  const r3 = submit('帮我修改一下README文件，更新版本号并补充新增参数的完整说明'); // 改
  ok('v8c 改轮全量 trio 含最小完备集', r3.out.includes('[开工三件套]') && r3.out.includes('最小完备集'), r3.out.slice(0, 80));
}
{
  // 功能文卫生：user 区 prose 落笔扫"祈使负向且同句无正向替代"，advisory 不拦断
  const SIDP = SID + '-p';
  const submitP = (p) => run('UserPromptSubmit', { sessionId: SIDP, prompt: p });
  const editP = (fp, ns) => run('PreToolUse', { sessionId: SIDP, toolName: 'Edit', toolInput: { file_path: fp, old_string: 'a', new_string: ns || 'b' }, cwd: HOME });
  submitP('帮我修改一下README文件，补充新增参数的完整使用说明');
  const MD = path.join(REPO, `readme-hygiene-${TS}.md`); // 新文件：路径守卫放行面（AI 创建）
  editP(MD, '初始化。'); // 消耗 GATE_MSG 槽（改类首次写先收三件套对账）
  const r = editP(MD, '部署步骤如下。\n不要手动编辑这个文件。\n');
  ok('v8f 祈使负向无正向替代→功能文卫生提醒', r.code === 0 && r.out.includes('功能文卫生'), `code=${r.code} out=${r.out.slice(0, 90)}`);
  const r2 = editP(MD, '再补一句不要手动编辑这个文件。');
  ok('v8g 同文件第二次→不再提醒', r2.code === 0 && !r2.out.includes('功能文卫生'), r2.out.slice(0, 60));
  const r3 = editP(path.join(REPO, `readme-ok-${TS}.md`), '不要手动编辑这个文件，请用生成器重建。\n');
  ok('v8h 同句带正向替代→不提醒', r3.code === 0 && !r3.out.includes('功能文卫生'), r3.out.slice(0, 60));
  const r4 = editP(path.join(REPO, 'AGENTS.md'), '不要手动编辑这个文件。\n');
  ok('v8i 规则文件豁免', r4.code === 0 && !r4.out.includes('功能文卫生'), r4.out.slice(0, 60));
  const r5 = editP(path.join(HOME, '.zcode', 'workspace', `t-${TS}.md`), '不要手动编辑这个文件。\n');
  ok('v8j scratch 区豁免', r5.code === 0 && !r5.out.includes('功能文卫生'), r5.out.slice(0, 60));
  const r6 = editP(path.join(REPO, `code-${TS}.js`), '不要手动编辑这个文件。\n');
  ok('v8k 非 prose 目标豁免', r6.code === 0 && !r6.out.includes('功能文卫生'), r6.out.slice(0, 60));
  const r7 = run('PreToolUse', { sessionId: SIDP, toolName: 'Write', toolInput: { file_path: path.join(REPO, `write-${TS}.md`), content: '用法说明。\n禁止在生产环境直接运行。\n' }, cwd: HOME });
  ok('v8l Write 工具同样扫描', r7.code === 0 && r7.out.includes('功能文卫生'), `code=${r7.code} out=${r7.out.slice(0, 90)}`);
}

console.log(`\n==== ${pass} pass, ${fail} fail ====`);
if (failures.length) { console.log('FAILURES:'); for (const f of failures) console.log(' -', f); process.exit(1); }
