// browser-route hook 测试台。用法: node test-browser-route.js [被测hook路径]
// 每次运行用独立 sid，避免与真实会话状态互相污染。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = process.argv[2] || path.join(__dirname, 'browser-route.js');
const HOME = process.env.USERPROFILE || process.env.HOME;
const SID = `brtest-${Date.now()}`;

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; failures.push(name + (extra ? ' :: ' + extra : '')); console.log('  FAIL', name, extra || ''); }
}
function run(payload, sid) {
  const r = spawnSync(process.execPath, [HOOK, 'UserPromptSubmit'], {
    input: JSON.stringify({ sessionId: sid || SID, ...payload }),
    encoding: 'utf8', timeout: 8000,
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
const submit = (prompt, sid) => run({ prompt }, sid);
const ctxOf = (r) => {
  try { return JSON.parse(r.out).hookSpecificOutput.additionalContext || ''; }
  catch { return ''; }
};

// ── 命中注入 ──
{
  const r = submit('帮我测试一下 localhost:3000 的前端页面渲染效果');
  const c = ctxOf(r);
  ok('浏览器任务注入路线规则', c.includes('[浏览器路线]'), r.out.slice(0, 120));
  ok('注入点名 browser-use 入口', c.includes('agent.browsers.get("iab")'));
  ok('注入给出 playwright 专属场景', c.includes('console') && c.includes('network'));
  ok('注入含截图投递方式', c.includes('nodeRepl.emitImage'));
  ok('退出码 0', r.code === 0);
}

// ── 各类浏览器关键词都应命中 ──
// 每个用例用独立 sid：hook 按会话去重，同 sid 的后续用例会被跳过。
for (const [label, prompt] of [
  ['中文浏览器', '打开浏览器看看这个页面'],
  ['截图', '帮我截个图'],
  ['前端', '检查一下前端渲染'],
  ['localhost', '访问 http://localhost:8080'],
  ['https url', '打开 https://example.com 看看'],
  ['DOM', '查一下 DOM 结构'],
]) {
  ok(`命中：${label}`, ctxOf(submit(prompt, `brtest-kw-${label}-${Date.now()}`)).includes('[浏览器路线]'));
}

// ── 非浏览器任务不注入 ──
for (const [label, prompt] of [
  ['仓库提交', '帮我看一下这个仓库最近的提交历史'],
  ['纯代码', '写一个函数反转链表'],
  ['配置', '检查一下环境变量配置'],
]) {
  const r = submit(prompt, `brtest-neg-${label}-${Date.now()}`);
  ok(`不注入：${label}`, r.out.trim() === '' && r.code === 0, r.out.slice(0, 80));
}

// ── 用户点名 playwright 时尊重指定 ──
{
  const r = submit('用 playwright 打开 example.com 截图', `brtest-pw-${Date.now()}`);
  ok('显式点名 playwright → 不改路线', r.out.trim() === '', r.out.slice(0, 120));
}

// ── 同会话只注入一次 ──
{
  const sid = `brtest-dedup-${Date.now()}`;
  const first = submit('打开浏览器看下页面', sid);
  const second = submit('再看下这个页面的 console', sid);
  ok('首次注入', ctxOf(first).includes('[浏览器路线]'));
  ok('同会话二次不重复注入', second.out.trim() === '', second.out.slice(0, 120));
}

// ── ambient 消息不注入 ──
{
  const r = submit('<in-app-browser-context source="ambient-ui-state">some page</in-app-browser-context>', `brtest-amb-${Date.now()}`);
  ok('ambient 消息不注入', r.out.trim() === '');
}

// ── system-reminder 信封被剥除 ──
{
  const r = submit('<system-reminder>skills list</system-reminder>\n帮我看下这个仓库', `brtest-env-${Date.now()}`);
  ok('信封内的无关词不触发注入', r.out.trim() === '', r.out.slice(0, 120));
}

// ── 畸形输入不阻塞会话 ──
{
  const r = spawnSync(process.execPath, [HOOK, 'UserPromptSubmit'], {
    input: 'not-json-at-all', encoding: 'utf8', timeout: 8000,
  });
  ok('畸形 JSON → exit 0 且无输出', r.status === 0 && !(r.stdout || '').trim());
  const r2 = spawnSync(process.execPath, [HOOK, 'UserPromptSubmit'], {
    input: '', encoding: 'utf8', timeout: 8000,
  });
  ok('空输入 → exit 0 且无输出', r2.status === 0 && !(r2.stdout || '').trim());
}

// ── 清理状态文件 ──
try {
  const dir = path.join(HOME, '.zcode', 'hooks', 'state');
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith('browser-route-brtest-')) fs.unlinkSync(path.join(dir, f));
  }
} catch { /* 清理失败不影响断言 */ }

console.log(`\n==== ${pass} pass, ${fail} fail ====`);
if (fail) { failures.forEach((f) => console.log('  FAILED:', f)); process.exit(1); }
