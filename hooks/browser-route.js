// 浏览器路线引导 hook（browser-route.js）
// 用法: node browser-route.js UserPromptSubmit
// 作用: 当本轮任务涉及浏览器操作时，在消息尾部注入"默认走 browser-use"的路线规则。
//
// 落点理由（来自记忆 zcode-tool-menu-mechanics 的实测）:
//   - ZCode 把 AGENTS.md 注入到 messages 的第一个 user 消息，离当前轮可达 250K tokens，
//     实测同会话内首位的委派规则 0 次被采纳；
//   - UserPromptSubmit 的 additionalContext 落在消息数组末尾、紧邻当前轮，
//     同会话对比下尾部注入的采纳率明显更高（同会话的 TodoWrite 提醒基本次次被采纳）。
//   所以"随时机变化的触发指令"放 hook 通道，"不随轮次变化的稳定约定"放 AGENTS.md。
//
// 输出: {hookSpecificOutput:{hookEventName:"UserPromptSubmit", additionalContext:"..."}}
//       不命中则输出空（放行）。任何内部错误静默 exit 0 —— hook 故障不得阻塞会话。
//
// 2026-10-30 建立：用户要求"调一下，让模型倾向调用 browser use"。

const fs = require('fs');
const path = require('path');

const EVENT = process.argv[2] || 'UserPromptSubmit';
const HOME = process.env.HOME || process.env.USERPROFILE;
const STATE_DIR = path.join(HOME, '.zcode', 'hooks', 'state');

// 浏览器意图关键词：任务里出现这些才注入，避免给无关轮次加噪音。
// 口语变体一并收录（"截个图"/"开下浏览器"），漏触发的代价是模型直接退回 curl/WebFetch 抓文本。
const RE_BROWSER = new RegExp([
  '浏览器', '网页', '前端', '页面', '渲染', '截图', '截个图', '截屏', '录屏', '界面', 'UI',
  'localhost', '127\\.0\\.0\\.1', 'http://', 'https://',
  'playwright', 'browser.use', 'web-gui', 'DOM', '元素定位', '点击', '表单',
  'console', 'network', '响应头', '请求体',
  '打开页面', '看看效果', '跑起来看', '实际效果', '视觉验收', '视觉检查',
].join('|'), 'i');

// 明确点名 playwright 时不注入 —— 用户自己指定了路线，尊重该指定。
const RE_EXPLICIT_PW = /playwright/i;

// 已经用 browser-use 路线说话时（提到 node_repl / iab / browser-use），不重复注入。
const RE_ALREADY_BU = /node_repl|\biab\b|browser-use|browser use/i;

const CONTEXT = [
  '[浏览器路线]',
  '浏览器任务默认走 browser-use：mcp__node_repl__js + scripts/browser-client.mjs，后端是 ZCode 内嵌浏览器（IAB）。',
  '入口：agent.browsers.get("iab") → tab.goto / tab.playwright.domSnapshot / tab.screenshot / tab.cua / tab.dom_cua。',
  '截图进上下文用 nodeRepl.emitImage(await tab.screenshot())；每个 js cell 都需重新 bootstrap（kernel 不保留变量）。',
  'playwright MCP 留给它的专属场景：console 报错捕获、network 请求体检查、route mock、cookie/localStorage 读写、文件上传、PDF 导出、emulate_media、run_code_unsafe。',
  '判据：先问"这次要不要 console / network / mock / cookie / 上传 / PDF"——要则用 playwright MCP，否则用 browser-use；同一任务可混用。',
].join('\n');

function stripEnvelope(text) {
  // 去掉 <system-reminder> / <command-name> 等信封，只看用户实际输入。
  return String(text || '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, ' ')
    .replace(/<[^>]{0,40}>/g, ' ');
}

function readState(sessionId) {
  try {
    const file = path.join(STATE_DIR, 'browser-route-' + String(sessionId).replace(/[^A-Za-z0-9._-]/g, '_') + '.json');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(sessionId, state) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const file = path.join(STATE_DIR, 'browser-route-' + String(sessionId).replace(/[^A-Za-z0-9._-]/g, '_') + '.json');
    fs.writeFileSync(file, JSON.stringify(state));
  } catch {
    /* 状态写入失败不影响放行 */
  }
}

function emit(additionalContext) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: EVENT, additionalContext },
  }));
}

function main() {
  let input = {};
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    process.exit(0);
  }

  const sessionId = input.sessionId || process.env.CLAUDE_SESSION_ID || 'unknown';
  const raw = stripEnvelope(input.prompt || '');

  // ambient 消息（自动注入的环境态）不注入。
  if (/^\s*(<in-app-browser-context|Perform a web search)/.test(String(input.prompt || ''))) {
    process.exit(0);
  }

  if (!RE_BROWSER.test(raw)) {
    process.exit(0);
  }
  // 用户点名 playwright：尊重指定，不改路线。
  if (RE_EXPLICIT_PW.test(raw) && !RE_ALREADY_BU.test(raw)) {
    process.exit(0);
  }
  // 本会话已注入过则不重复；跨会话重新计数（新会话重新给一次）。
  const state = readState(sessionId);
  if (state.injected) {
    process.exit(0);
  }

  writeState(sessionId, { injected: true, ts: Date.now() });
  emit(CONTEXT);
  process.exit(0);
}

try {
  main();
} catch {
  process.exit(0);
}
