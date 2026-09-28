// ask-first 开工三件套外置闸门 v2（与 skills/ask-first v2 配套）。
// 用法: node askfirst-gate.js <UserPromptSubmit|PreToolUse|Stop>
// 安装: ./install.sh --hooks （复制本文件到 ~/.zcode/hooks/ 并合并 ZCode config.json）
// 输入: stdin JSON (ZCode hook payload)。输出: {hookSpecificOutput:{hookEventName, additionalContext}} 或空(放行)。
// 任何内部错误都静默 exit 0——闸门故障不得阻塞会话。
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const EVENT = process.argv[2] || '';
const HOME = process.env.HOME || process.env.USERPROFILE;
const ROLLOUT_DIR = process.env.ASKFIRST_ROLLOUT_DIR || path.join(HOME, '.zcode', 'cli', 'rollout');
const TAIL_BYTES = 256 * 1024;

const FLIP_ADV = /\bbut wait\b|\bno wait\b|\bactually wait\b|\bwait no\b|\boh wait\b|\bhold on\b|let me (?:re)?consider|let me re-?read/gi;
const FLIP_CORE = /\b(?:wait|hmm)\b/gi;
const FLIP_CN = /等等|其实|(?<![对不])不对(?!称)/g;

const RE_ENV = /卸载|安装|装一?[个下]|配置|环境变量|报错|启动失败|排查|debug|不工作|打不开|无法启动|链接失败|link|install|火绒|代理|pnpm|npm (i|install)/i;
const RE_PLAN = /想.{0,6}方案|方案|思路|建议|意见|想法|设计如何|怎么样|如何改进|改进空间|评审|审查|分析|说说你的| evaluation/i;
const RE_MODIFY = /实现|重构|修改|改成|改一下|新增|加一?[个上条]|删除|去掉|替换|修复|fix|refactor|移植|迁移|写一?[个条]|发版|构建|提交|推送/i;
const RE_RESEARCH = /调研|是什么|什么是|对比|评估|有哪些|看看|了解|查一下|search|为什么/i;
const RE_CONT = /^(可以|好的|继续|ok|嗯+|哦|对|是的|行|go|yes|continue|接着|然后|没问题|收到|按|执行|就这样|可以了)\b/i;

function readState(sid) {
  try { return JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `zcode-askfirst-${sid}.json`), 'utf8')); }
  catch { return null; }
}
function writeState(sid, st) {
  try { fs.writeFileSync(path.join(os.tmpdir(), `zcode-askfirst-${sid}.json`), JSON.stringify(st)); } catch {}
}
function stripEnvelope(s) {
  return String(s || '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}
function classify(p) {
  if (RE_ENV.test(p)) return '环境';
  if (RE_PLAN.test(p)) return '读';
  if (RE_MODIFY.test(p)) return '改';
  if (RE_RESEARCH.test(p)) return '检索';
  return '读';
}
function countFlips(text) {
  if (!text) return 0;
  let n = 0;
  const rest = text.replace(FLIP_ADV, '');
  n += (text.match(FLIP_ADV) || []).length;
  n += (rest.match(FLIP_CORE) || []).length;
  n += (rest.match(FLIP_CN) || []).length;
  return n;
}
function emit(eventName, additionalContext) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext } }));
}

const TRIO_MSG = (type) =>
  `[开工三件套] 本任务分类=${type}。动手前在交付说明开头给出：①类型与对象；②Done when（完成口径）；③一次 AskUserQuestion 反问批次（≤4题，题目只锚定 done-when 口径确认与真实分叉 A/B/范围/术语；grep 能答的先自查）。若无任何真分叉，明确写"无分叉"后开工。`;

const DRIFT_MSG =
  `[类型漂移] 本任务开工时声明为读/检索，现在第一次落笔修改。按 ask-first 漂移闸门：把类型更正为"读并改"，并补一次 AskUserQuestion 反问批次（锚定 done-when 口径与真实分叉；grep 能答的先自查），或声明"无新分叉"后再继续修改。`;

const GATE_MSG =
  `[三件套对账] 本任务尚未见反问批次。落笔前发一次 AskUserQuestion（锚定 done-when 口径与真实分叉），或在回复开头补全三件套声明；若确无分叉，写明"无分叉"后继续。`;

const FLIP_MSG = (n) =>
  `[ask-first 对账] 最新思考段检测到 ${n} 个翻转信号且本任务未反问：对真实分叉发一次 AskUserQuestion，或写明为何无需问后收尾。`;

function onUserPromptSubmit(input) {
  const sid = input.sessionId || process.env.CLAUDE_SESSION_ID || 'unknown';
  const p = stripEnvelope(input.prompt);
  if (!p) return;
  if (p.length < 30 && RE_CONT.test(p)) { const st = readState(sid); if (st) { st.ts = Date.now(); writeState(sid, st); } return; }
  const type = classify(p);
  writeState(sid, { taskKey: crypto.createHash('md5').update(p.slice(0, 500)).digest('hex').slice(0, 8), type, gateAsked: false, driftNotified: false, flipsNotified: false, ts: Date.now() });
  if (type === '改' || type === '环境') emit('UserPromptSubmit', TRIO_MSG(type));
}

function onPreToolUse(input) {
  const sid = input.sessionId || process.env.CLAUDE_SESSION_ID || 'unknown';
  const tool = input.toolName || '';
  const st = readState(sid) || { taskKey: 'adhoc', type: 'unknown', gateAsked: false, driftNotified: false, flipsNotified: false, ts: Date.now() };
  if (tool === 'AskUserQuestion') { st.gateAsked = true; writeState(sid, st); return; }
  if (st.type === '改' || st.type === '环境') {
    if (!st.gateAsked) { st.gateAsked = true; writeState(sid, st); emit('PreToolUse', GATE_MSG); }
  } else if (!st.driftNotified) {
    st.driftNotified = true; writeState(sid, st); emit('PreToolUse', DRIFT_MSG);
  }
}

function onStop(input) {
  const sid = input.sessionId || process.env.CLAUDE_SESSION_ID || 'unknown';
  const st = readState(sid) || { taskKey: 'adhoc', type: 'unknown', gateAsked: false, driftNotified: false, flipsNotified: false, ts: Date.now() };
  if (st.flipsNotified) return;
  const file = path.join(ROLLOUT_DIR, `model-io-sess_${sid}.jsonl`);
  let size = 0; try { size = fs.statSync(file).size; } catch { return; }
  const start = Math.max(0, size - TAIL_BYTES);
  let buf;
  try { const fd = fs.openSync(file, 'r'); buf = Buffer.alloc(size - start); fs.readSync(fd, buf, 0, buf.length, start); fs.closeSync(fd); } catch { return; }
  const lines = buf.toString('utf8').split('\n');
  const segs = []; let asks = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    const th = rec.response && rec.response.reasoningText;
    if (typeof th === 'string' && th.length > 50) segs.push(th);
    for (const tc of (rec.response && rec.response.toolCalls) || []) {
      if (((tc.function && tc.function.name) || tc.name || '') === 'AskUserQuestion') asks++;
    }
  }
  if (asks > 0 || segs.length === 0) return;
  const last = countFlips(segs[segs.length - 1]);
  const prev = countFlips(segs[segs.length - 2] || '');
  if (last >= 5 || (last >= 3 && prev >= 3)) {
    st.flipsNotified = true; writeState(sid, st);
    emit('Stop', FLIP_MSG(last));
  }
}

(async () => {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input = {};
  try { input = JSON.parse(raw); } catch {}
  try {
    if (EVENT === 'UserPromptSubmit') onUserPromptSubmit(input);
    else if (EVENT === 'PreToolUse') onPreToolUse(input);
    else if (EVENT === 'Stop') onStop(input);
  } catch {}
  process.exit(0);
})();
