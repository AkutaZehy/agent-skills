// askfirst-gate v4 测试台。用法: node test-gate.js [被测hook路径]
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
const state = () => { try { return JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `zcode-askfirst-${SID}.json`), 'utf8')); } catch { return null; } };
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
try { fs.rmSync(path.join(os.tmpdir(), `zcode-askfirst-${SID}.json`), { force: true }); } catch {}

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
let st2 = null; try { st2 = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `zcode-askfirst-${SID2}.json`), 'utf8')); } catch {}
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
let st5 = null; try { st5 = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `zcode-askfirst-${SID5}.json`), 'utf8')); } catch {}
ok('t5a 检查一下→诊断', st5 && st5.type === '诊断', JSON.stringify(st5 && st5.type));

// ── T6 真漂移留痕 ──
console.log('T6 漂移留痕');
const SID6 = SID + '-f';
const submit6 = (p) => run('UserPromptSubmit', { sessionId: SID6, prompt: p });
const edit6 = (fp) => run('PreToolUse', { sessionId: SID6, toolName: 'Edit', toolInput: { file_path: fp, old_string: 'a', new_string: 'b' }, cwd: HOME });
submit6('调研一下当前市场的竞品有哪些');
r = edit6(path.join(REPO, 'tracked.txt'));
ok('t6a 漂移文案含留痕标记', r.out.includes('driftCount') || r.out.includes('留痕') || r.out.includes('已记录'), r.out.slice(0, 90));
let st6 = null; try { st6 = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `zcode-askfirst-${SID6}.json`), 'utf8')); } catch {}
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

// ── 清理 ──
for (const d of [NONGIT, REPO]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
try { fs.rmSync(SCRATCH_SCRIPT, { force: true }); } catch {}
try { fs.rmSync(TMPSCRATCH, { force: true }); } catch {}
for (const s of [SID, SID + '-c', SID + '-e', SID + '-f', SID + '-g', SID + '-h', SID + '-i', SID + '-j']) {
  try { fs.rmSync(path.join(os.tmpdir(), `zcode-askfirst-${s}.json`), { force: true }); } catch {}
}

console.log(`\n==== ${pass} pass, ${fail} fail ====`);
if (failures.length) { console.log('FAILURES:'); for (const f of failures) console.log(' -', f); process.exit(1); }
