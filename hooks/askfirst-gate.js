// ask-first 开工三件套外置闸门 v4（与 skills/ask-first v2 配套）。
// 用法: node askfirst-gate.js <UserPromptSubmit|PreToolUse|Stop>
// 安装: ./install.sh --hooks （复制本文件到 ~/.zcode/hooks/ 并合并 ZCode config.json）
// 输入: stdin JSON (ZCode hook payload)。输出: {hookSpecificOutput:{hookEventName, additionalContext}} 或空(放行)；
//       拦截时向 stderr 写理由并 exit 2（ZCode 语义：PreToolUse deny）。
// 任何内部错误都静默 exit 0——闸门故障不得阻塞会话（git/路径解析失败一律放行）。
// v3: 补 fs require（v2 遗漏导致状态文件从未生效）；新增 Bash 门禁——
//     变更类阻断式（rm/cp/mv/重定向/解包等，hook 自查目标存在性，有东西可丢才拦，被拦的同一命令重跑放行）；
//     git 状态覆盖类阻断式（reset --hard/checkout --/restore/stash drop/clean/branch -D/tag -d）；
//     外发类全拦（git push/npm publish|unpublish/gh repo delete/gh release create|delete|upload/gh api -X 写操作）；
//     改类提醒式（sed -i/perl -pi/amend/rebase/filter-branch/stash pop/patch，每类每会话提醒一次）。
// v4（2026-10-04 治理包，基于三周 rollout 审计 askq-*）:
//   a. ambient/自动消息(in-app-browser-context / SYSTEM NOTIFICATION / Perform a web search)不重分类不重置任务态;
//   b. RE_CONT 去 \b（纯 CJK 续接 v3 永远失配）;
//   c. 检查/审查/通读/审计入诊断类（前置，避开"查一下"子串误判检索）;
//   d. 关键词未命中 fallback=unknown：提交不注入，首笔修改性写收中性对账;
//   e. RE_MODIFY 词表放宽（更新/修正/调整/补完/整理/做个/写一下/生成/换成/清理/试试/帮我/顺手——"更新"为实测最高频缺失动词）;
//   f. 漂移只计修改性写（工具性/记忆/元配置写豁免），文案改留痕版，driftCount 入状态文件;
//   g. 诊断类型：首次修改性写前注入[诊断纪律]（advisory 不拦断）;
//   h. 路径守卫：写/改/删前判定目标回滚性——临时/缓存、脚本区、记忆目录放行；git tracked 放行；
//      untracked 预存在或非 git 目录预存在→拦一次核对拼写后重跑放行（confirm-token，防拼错路径+无回滚）;
//   i. 脚本执行内容扫描：scratch 区脚本执行前静态扫内容，命中 rm/rmSync/sed -i/git push 等→确认一次;
//   j. Bash 变更门禁豁免 scratch/记忆区（实测工具性 331 次为误拦上限）。
// v4B (M1 完成断言证据门，2026-10-04)：Stop 侧复用同一 tail buffer 单次解析双用——末段 AI 文本命中窄口径
//   完成断言词且近旁无对冲词、同轮无验证类命令→advisory 注入"列证据或改写为待验证"，每会话一次
//   （独立键 state.doneGate）。治十六格矩阵⑯格（人盲×AI盲）：无证据背书的完成话术。
// v4C (确认点门禁，2026-10-04，治"question 绕行"违规)：用户流程指令中的硬停点（"我再确认文件名"
//   "先写一下我看看风格"）与 AI 问题文本中的确认承诺（"文件名我组装后你再确认"）状态化为
//   state.pendingConfirm；期间 user 区写/Edit/Bash 写路径/重定向/cp·mv 目标一律硬拦（新建也拦，
//   不记 token——重跑不放行，区别于路径守卫），仅真实用户轮（UserPromptSubmit）解除——
//   AskUserQuestion 的选项回答是 tool_result 形态不触发 UPS，不解除（正是违规形态：问了很多问题、
//   用户答了系列名，组装后的文件名与样张从未给用户看就直接落盘）。scratch/记忆/meta 区与
//   工具脚本命名（SCRATCH_BASENAME）不受限。确认 deny 计数入 state.confirmDenies（站会审计可见）。
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { execFileSync } = require('child_process');

const EVENT = process.argv[2] || '';
const HOME = process.env.HOME || process.env.USERPROFILE;
const ROLLOUT_DIR = process.env.ASKFIRST_ROLLOUT_DIR || path.join(HOME, '.zcode', 'cli', 'rollout');
const TAIL_BYTES = 256 * 1024;
const MEMDIR = path.join(HOME, '.zcode', 'cli', 'memories').toLowerCase();
const ZCODE_ROOT = path.join(HOME, '.zcode').toLowerCase();
const GIT_TIMEOUT = 1500;

const FLIP_ADV = /\bbut wait\b|\bno wait\b|\bactually wait\b|\bwait no\b|\boh wait\b|\bhold on\b|let me (?:re)?consider|let me re-?read/gi;
const FLIP_CORE = /\b(?:wait|hmm)\b/gi;
const FLIP_CN = /等等|其实|(?<![对不])不对(?!称)/g;

const RE_ENV = /卸载|安装|装一?[个下]|配置|环境变量|报错|启动失败|排查|debug|不工作|打不开|无法启动|链接失败|link|install|火绒|代理|pnpm|npm (i|install)/i;
const RE_PLAN = /想.{0,6}方案|方案|思路|建议|意见|想法|设计如何|怎么样|如何改进|改进空间|评审|分析|说说你的| evaluation/i;
const RE_DIAG = /检查|审查|通读|审一遍|找.{0,3}问题|挑错|审计|体检|复核|核对|review|过一遍/i;
const RE_MODIFY = /实现|重构|修改|改成|改一下|更新|修正|调整|补完|补充|新增|加一?[个上条组段节章项行]|删除|去掉|替换|修复|fix|refactor|移植|迁移|写一?[个条份篇章节]|发版|构建|提交|推送|生成|画|导入|导出|批量|重命名|拉取|克隆|恢复|禁用|启用|隐藏|清理|合并|拆|做个|做一个|做一下|写一下|换成|试试|帮我|顺手|改/i;
const RE_RESEARCH = /调研|是什么|什么是|对比|评估|有哪些|看看|了解|查一下|search|为什么/i;
const RE_CONT = /^(可以|好的|继续|ok|嗯+|哦|对|是的|行|go|yes|continue|接着|然后|没问题|收到|按|执行|就这样|可以了|修|发|暂停|先这样|收工|等等)/i;
// v5 计划态/描述：RE_FUTURE=自报计划措辞（计划态，本轮不动手）；RE_PASTE=终端粘贴开头（意图位置不可靠，
// 判"描述"交给模型侧交叉确认）；RE_ENVELOPE=压缩续跑信封（非用户意图，ambient 级跳过不重置任务态）。
const RE_FUTURE = /我(计划|打算|在考虑|可能(要|需要|会)|或许(该|需要))|考虑(把|去|先|要不要)|准备(把|去|先)|打算(把|去|先)|planning to|i'm (planning|considering)|i (guess|think) i (should|need|will)|i (might|may) (need|want)/i;
const RE_PASTE = /^[A-Za-z]:\\[^\n]{0,80}>|^\w+@[^\s]+[^\n]{0,60}\$ /;
const RE_ENVELOPE = /^This session is being continued from a previous conversation/i;
const AMBIENT_RE = /^\s*(<in-app-browser-context|Perform a web search for the query:)/;

// v4C 确认点门禁：用户流程指令中的硬停点（"我再确认X""先写一下我看看"）与 AI 问题文本中的确认承诺
// （"文件名我组装后你再确认"）状态化为 pendingConfirm；期间用户资产写硬拦（无 token 重跑放行机制），
// 仅真实用户轮（UserPromptSubmit）解除——AskUserQuestion 的选项回答是 tool_result 形态，不解除。
const CONFIRM_RE = /我再确认|等我确认|我确认一下|我过目|我拍板|先给我看|写一下我看看|我看看再|看看风格|看看.{0,8}再说|看完再|确认后再|确认之后|我看完[后再]/;
const CONFIRM_ASK_RE = /(你|我)再?确认|先给[你我]看|[你我]看看|给我看一?下/;

// v6: 状态落固定目录（原先用 os.tmpdir()，临时目录会被系统清理，状态一丢就退回'每会话首次'）。
const STATE_DIR = path.join(HOME || os.homedir(), '.zcode', 'hooks', 'state');
const STATE_TTL_MS = 24 * 60 * 60 * 1000;   // 过期状态 24h 后清理
function statePath(sid) {
  return path.join(STATE_DIR, 'zcode-askfirst-' + String(sid).replace(/[^A-Za-z0-9._-]/g, '_') + '.json');
}
function readState(sid) {
  try {
    const p = statePath(sid);
    const st = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (st && typeof st.ts === 'number' && Date.now() - st.ts > STATE_TTL_MS) return null;   // 过期视为无状态
    return st;
  } catch { return null; }
}
function writeState(sid, st) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(statePath(sid), JSON.stringify(st));
    pruneStates();
  } catch (e) {
    // 失败可见：状态写不进去会让'每会话一次'退化成'每次都发'，静默会让这类问题藏很久。
    try { process.stderr.write('[ask-first] state write failed: ' + (e && e.message ? e.message : e) + '\n'); } catch {}
  }
}
let lastPrune = 0;
function pruneStates() {
  const now = Date.now();
  if (now - lastPrune < 10 * 60 * 1000) return;   // 每 10 分钟最多清一次
  lastPrune = now;
  try {
    for (const f of fs.readdirSync(STATE_DIR)) {
      if (!f.startsWith('zcode-askfirst-') || !f.endsWith('.json')) continue;
      const fp = path.join(STATE_DIR, f);
      try { if (now - fs.statSync(fp).mtimeMs > STATE_TTL_MS) fs.unlinkSync(fp); } catch {}
    }
  } catch {}
}
function stripEnvelope(s) {
  return String(s || '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}
function isAmbient(raw) {
  const s = String(raw || '');
  return AMBIENT_RE.test(s) || RE_ENVELOPE.test(s) || /<system-reminder>\s*\[SYSTEM NOTIFICATION/i.test(s);
}
function classify(p) {
  if (RE_PASTE.test(p)) return '描述';
  if (RE_FUTURE.test(p)) return '计划';
  if (RE_ENV.test(p)) return '环境';
  if (RE_DIAG.test(p) && !RE_MODIFY.test(p)) return '诊断';
  if (RE_PLAN.test(p)) return '读';
  if (RE_MODIFY.test(p)) return '改';
  if (RE_RESEARCH.test(p)) return '检索';
  return 'unknown';
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
function deny(msg) {
  process.stderr.write(msg + '\n');
  process.exit(2);
}

// ── 分区与路径守卫（v4 h/j/f 共用机械） ──────────────────────
function normWin(p) { return String(p || '').replace(/\//g, '\\').toLowerCase(); }
function zoneOf(p) {
  if (!p) return 'unknown';
  const lp = normWin(p);
  const tmp = normWin(os.tmpdir());
  if (lp === tmp || lp.startsWith(tmp + '\\')) return 'scratch';
  if (lp === ZCODE_ROOT || lp.startsWith(ZCODE_ROOT + '\\')) {
    if (/\\.zcode\\(skills|hooks)\\/.test(lp)) return 'meta';
    if (lp === path.join(ZCODE_ROOT, 'cli', 'config.json')) return 'meta';
    return 'scratch'; // .zcode 根(脚本之家)/tmp/workspace/cli(日志数据)/exec
  }
  if (lp === MEMDIR || lp.startsWith(MEMDIR + '\\')) return 'memory';
  return 'user';
}
function gitRootOf(p) {
  try {
    const out = execFileSync('git', ['-C', path.dirname(p), 'rev-parse', '--show-toplevel'], { timeout: GIT_TIMEOUT, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
    return out.trim();
  } catch { return null; }
}
function gitTracked(p, root) {
  try {
    execFileSync('git', ['-C', root, 'ls-files', '--error-unmatch', path.relative(root, p)], { timeout: GIT_TIMEOUT, stdio: 'ignore' });
    return true;
  } catch { return false; }
}
// 路径守卫核心：返回 deny 理由或 null（放行）。op: write|rm|rmdir——write 对新建文件记为 AI 创建。
function pathGuard(st, w, op) {
  const zone = zoneOf(w);
  if (zone === 'scratch' || zone === 'memory' || zone === 'unknown') return null;
  const key = normWin(w);
  st.created = st.created || [];
  st.confirmed = st.confirmed || {};
  const token = crypto.createHash('md5').update('pg:' + op + ':' + key).digest('hex').slice(0, 12);
  if (st.confirmed[token] || st.created.includes(key)) return null;
  if (!fs.existsSync(w)) { // 新建：AI 正在创建，无内容可丢
    if (op === 'write') st.created.push(key);
    return null;
  }
  const root = gitRootOf(w);
  if (root) {
    if (gitTracked(w, root)) return null; // git 可回滚
    if (op === 'rmdir') {
      try {
        const por = execFileSync('git', ['-C', root, 'status', '--porcelain', '--', path.relative(root, w)], { timeout: GIT_TIMEOUT, encoding: 'utf8' });
        if (!String(por).trim()) return null; // 目录内全干净，删了也能 checkout 回来
      } catch { return null; }
    }
  }
  st.confirmed[token] = Date.now();
  const zoneLabel = root ? 'git 仓库内未被追踪的既有文件' : '无版本管理的目录';
  return `[ask-first 路径守卫] 目标位于${zoneLabel}，改/删后不可回滚：${w}\n先核对路径拼写（大小写/相近目录名），cat/ls 看一眼内容确认没找错目标；确认后重跑同一操作即放行。`;
}
// 写行为分类（漂移/诊断/unknown 只计 'mod'）
const SCRATCH_BASENAME = /(?:^|[_\-.])(test|spec|check|plot|demo|smoke|debug|extract|analyze|analyse|audit|scratch|tmp|temp|verify|parity|build)[\w.\-]*\.(?:js|mjs|cjs|py|ts|sh|ps1|bat)$/i;
function writeKind(toolName, w) {
  const zone = zoneOf(w);
  if (zone === 'scratch') return 'tool';
  if (zone === 'memory') return 'mem';
  if (zone === 'meta') return 'meta';
  if (toolName === 'write' || toolName === 'Write') { // 新建文件用命名启发；edit 改既有文件天然修改性
    const bn = path.basename(normWin(w));
    if (SCRATCH_BASENAME.test(bn)) return 'tool';
  }
  return 'mod';
}
// v4C: 确认点拦截谓词——pending 期间 user 区写（工具脚本命名豁免），scratch/memory/meta 不受限
function confirmBlocked(st, w, kind) {
  if (!st || !st.pendingConfirm) return false;
  if (kind === 'tool') return false;
  return zoneOf(w) === 'user';
}
const confirmMsg = (st) =>
  `[ask-first 确认点门禁] 用户在本轮保留了确认权（「${(st && st.pendingConfirm && st.pendingConfirm.q) || ''}」）。先把拟落笔的文件名/样张/方案贴出来等用户回复，用户回应（普通消息即可；AskUserQuestion 的选项回答不算）后继续；scratch/记忆区与工具脚本不受限。本拦不因重跑同一操作而放行。`;

const TRIO_MSG = (type) =>
  `[开工三件套] 本任务分类=${type}（关键词初判，模型判读可推翻）。动手前在交付说明开头给【任务确认】块：任务数+每项类型与对象+hook判vs模型判对照，不一致（含计划态/描述/多任务）时先 AskUserQuestion 质询再动手，用户裁决后写分歧台账（AGENTS.md 口径）。随后逐任务给：①类型与对象；②Done when（完成口径）；③一次 AskUserQuestion 反问批次（≤4题，题目只锚定 done-when 口径确认与真实分叉 A/B、范围、术语；grep 能答的先自查）。若无任何真分叉，明确写"无分叉"后开工。`;

const DIAG_TRIO_MSG =
  `[开工三件套·诊断] 本任务分类=诊断（检查/审查/通读找问题）。①类型与对象；②Done when；③一次 AskUserQuestion 反问批次（≤4题，锚定口径确认与真实分叉；grep 能答的先自查），若无真分叉写明"无分叉"后开工。诊断任务默认零修改：发现问题时先报告并给修复选项，等用户点头或本轮已明示可修再动。多任务先在【任务确认】块拆分（任务数+hook判vs模型判对照，不一致先质询）。`;

const PLAN_TRIO_MSG =
  `[开工三件套·计划] 本任务分类=计划（计划态：用户宣布意图，本轮不动手）。只做只读核查与方案讨论；交付说明开头给【任务确认】块：任务数+每项类型与对象+hook判vs模型判对照（不一致→先质询）。禁止编辑落笔与执行确认式反问（"删除范围选哪个"这类把执行当既定事实的提问）；用户显式下令（删吧/动手/按清单执行）才进入执行，且只授权被点名的部分。`;

const PLAN_MSG =
  `[计划态纪律] 本任务为计划态（用户宣布意图），刚才的写入属于修改性操作。回到只读核查与方案讨论，或取得用户显式执行指令后继续；本次已记录，站会审计可见。`;

const DIAG_MSG =
  `[诊断纪律] 本任务为诊断/审查，刚才的写入属于修改性操作。默认零修改：要修复先给选项征得同意（或用户本轮已明示可修后继续）；本次已记录，站会审计可见。`;

const UNKNOWN_MSG =
  `[三件套对账] 本任务开工时类型未明（unknown），现在首次落笔修改。把类型更正为"读并改"并补全三件套声明（类型/Done when/反问批次），确无分叉则写明"无分叉"后继续；本次已记录。`;

const DRIFT_MSG =
  `[类型漂移·留痕] 本任务声明为读/检索/描述，现在落笔修改。把类型更正为"读并改"，声明"无新分叉"或补一次反问批次（锚定 done-when 口径与真实分叉；grep 能答的先自查）。本次漂移已记录（driftCount+1，站会审计可见）。`;

const GATE_MSG =
  `[三件套对账] 本任务尚未见反问批次。落笔前发一次 AskUserQuestion（锚定 done-when 口径与真实分叉），或在回复开头补全三件套声明；若确无分叉，写明"无分叉"后继续。`;

const FLIP_MSG = (n) =>
  `[ask-first 对账] 最新思考段检测到 ${n} 个翻转信号且本任务未反问：对真实分叉发一次 AskUserQuestion，或写明为何无需问后收尾。`;

// v4B (M1) 完成断言证据门：窄口径完成词 + 近旁对冲排除 + 同轮验证命令豁免
const DONE_RE = /修好了|搞定了|弄好了|已修复|完成[了。]|测试(全部)?通过|绿了|问题解决|已解决|可以用了|能用了|should (now )?work|works now|is fixed|all (tests )?pass|fixed\./gi;
const HEDGE_NEAR = /可能|或许|也许|不一定|不确定|试试看|might|maybe|possibly|perhaps|not sure/i;
const VERIFY_RE = /(npm|pnpm|yarn)\s+(test|run\s+test|run\s+build)|pytest|python\s+-m\s+pytest|node\s+--test|vitest|\bjest\b|\btsc\b|cargo\s+test|\bgo\s+test\b|make\s+(test|check)|\bnode\s+[^\s&|;]*(test|verify|check|smoke)[^\s&|;]*\.(js|mjs|cjs|py)\b/i;
const M1_MSG = (w) =>
  `[M1 完成断言证据门] 本轮收尾含完成断言（命中：${w}）。完成态表述需附证据链之一：①背书的测试/命令及其实际结果；②构建产物或实测输出引用。无法实证的部分改写为"预期完成，待验证"。（同轮已含验证命令的回合不触发；每会话至多一次）`;

// ── Bash 门禁 ───────────────────────────────────────────────
const EXTERNAL_HEADS = [
  [/^git$/, /^push$/],
  [/^npm$/, /^(publish|unpublish)$/],
  [/^gh$/, /^repo$/, /^delete$/],
  [/^gh$/, /^(release|workflow-dispatch)$/, /^(create|delete|upload)$/],
];
const GH_API_WRITE = /gh\s+api\b.*\s-X\s*(DELETE|POST|PUT|PATCH)\b/i;
const REMIND_HEADS = new Set(['sed', 'perl', 'patch', 'apply']);
const SCRIPT_EXEC_RE = /(?:^|[\s&|;])(?:node|python3?|npx|ts-node|bash|sh)\s+"?([^\s&|;"]+\.(?:js|mjs|cjs|py|ts|sh))"?/g;
const SCRIPT_DANGER = /rmSync\s*\(|rmtree|unlinkSync\s*\(|os\.remove|shutil\.|\brm\s+-|sed\s+-[a-z]*i|git\s+push|npm\s+publish|gh\s+release|Remove-Item|remove-item/;
const PS_RM = new Set(['remove-item', 'rm', 'del', 'erase', 'ri', 'rd', 'unlink', 'shred']);
const PS_CP = new Set(['copy-item', 'cp', 'copy', 'ci']);
const PS_MV = new Set(['move-item', 'mv', 'move', 'mi']);
const PS_SETCONTENT = new Set(['set-content', 'sc', 'add-content', 'out-file']);

function splitSegments(cmd) {
  const segs = [];
  let cur = '', q = '';
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { cur += c; if (c === q) q = ''; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '&' && cmd[i + 1] === '&' || c === '|' && cmd[i + 1] === '|' || c === ';' || c === '|' || c === '\n' || c === '\r') { segs.push(cur); cur = ''; if (c === '&' || c === '|') i++; continue; }
    cur += c;
  }
  segs.push(cur);
  return segs.map((s) => s.trim()).filter(Boolean);
}
function tokenize(seg) {
  const toks = [];
  let cur = '', q = '';
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (q) { if (c === q) { q = ''; toks.push(cur); cur = ''; } else cur += c; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (/\s/.test(c)) { if (cur) { toks.push(cur); cur = ''; } continue; }
    cur += c;
  }
  if (cur) toks.push(cur);
  return toks;
}
function cmdHead(toks) {
  let i = 0;
  while (i < toks.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i])) i++;
  if (i < toks.length && /^(sudo|command|nohup|env)$/i.test(toks[i])) i++;
  const h = toks[i] || '';
  return { head: h.split('/').pop().replace(/\.exe$/i, '').toLowerCase(), rest: toks.slice(i + 1) };
}
// PS 常量变量展开（$env:TEMP 等，pwsh 经 Bash 调用时出现）——只展开已知项，其余 fail-open
function expandVars(p) {
  if (!p || typeof p !== 'string') return p;
  return p
    .replace(/\$env:temp\b/gi, os.tmpdir())
    .replace(/\$env:tmp\b/gi, os.tmpdir())
    .replace(/\$env:userprofile\b/gi, HOME)
    .replace(/\$env:home\b/gi, HOME)
    .replace(/\$env:localappdata\b/gi, path.join(HOME, 'AppData', 'Local'));
}
function toWinPath(p, cwd) {
  if (!p || /\$/.test(p)) { p = expandVars(p); if (!p || /\$/.test(p)) return null; }
  p = p.replace(/^["']|["']$/g, '');
  p = p.replace(/[^\\]+[\\/]$/, '');
  if (p === '~') return HOME;
  if (p.startsWith('~/') || p.startsWith('~\\')) p = path.join(HOME, p.slice(2));
  const m = /^\/([a-zA-Z])\/(.*)$/.exec(p);
  if (m) return `${m[1].toUpperCase()}:\\${m[2]}`;
  if (/^\/tmp\b/.test(p)) p = path.join(os.tmpdir(), p.slice(4));
  if (/^\/dev\b/.test(p)) return null;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return p;
  if (path.isAbsolute(p)) return null;
  return path.resolve(cwd || process.cwd(), p);
}
const exists = (p) => { try { return p != null && fs.existsSync(p); } catch { return false; } };
const isDir = (p) => { try { return p != null && fs.statSync(p).isDirectory(); } catch { return false; } };
const nonEmpty = (p) => { try { return p != null && fs.statSync(p).isDirectory() && fs.readdirSync(p).length > 0; } catch { return false; } };

function redirectTargets(seg) {
  const out = [];
  const re = /(?<![0-9<>>])>\s*([^\s&|;<>]+)/g;
  let m;
  while ((m = re.exec(seg))) out.push(m[1]);
  return out;
}
// 脚本内容扫描（v4 i）：scratch 区脚本执行前扫内容
function scriptScan(st, cmd, cwd) {
  SCRIPT_EXEC_RE.lastIndex = 0;
  let m;
  while ((m = SCRIPT_EXEC_RE.exec(cmd))) {
    const w = toWinPath(m[1], cwd);
    if (!w || zoneOf(w) !== 'scratch') continue;
    let src = '';
    try { src = fs.readFileSync(w, 'utf8'); } catch { continue; }
    if (SCRIPT_DANGER.test(src)) {
      st.confirmed = st.confirmed || {};
      const token = crypto.createHash('md5').update('scan:' + normWin(w)).digest('hex').slice(0, 12);
      if (!st.confirmed[token]) {
        st.confirmed[token] = Date.now();
        return `[ask-first 脚本内容扫描] ${path.basename(w)} 位于脚本区，但内容含破坏性调用（rm/rmSync/sed -i/git push 等）。核对其目标路径（尤其是否指向用户资产与拼写）后，重跑同一命令即放行。`;
      }
    }
  }
  return null;
}

function onBashGate(input, sid) {
  const cmd = (input.toolInput || input.tool_input || {}).command || '';
  if (!cmd) return;
  const st = readState(sid) || {};
  st.confirmed = st.confirmed || {};
  st.reminded = st.reminded || {};
  const cwd0 = input.cwd || input.workingDirectory || process.cwd();
  const token = crypto.createHash('md5').update(cmd).digest('hex').slice(0, 12);

  // v4 i: 脚本内容扫描（先于分段循环，整命令维度）
  const scanMsg = scriptScan(st, cmd, cwd0);
  if (scanMsg) { writeState(sid, st); deny(scanMsg); }

  let verdict = null;
  let remind = null;
  let cwd = cwd0;

  for (const seg of splitSegments(cmd)) {
    const toks = tokenize(seg);
    const { head, rest } = cmdHead(toks);
    const flags = rest.filter((t) => t.startsWith('-')).join(' ');
    const args = rest.filter((t) => !t.startsWith('-') || /^(\/d|\/s)$/i.test(t));

    if (head === 'cd' || head === 'set-location') { const w = toWinPath((rest[0] || '').replace(/--$/, ''), cwd); if (w) cwd = w; continue; }
    if (/^dry-run$|^n$/.test(flags.replace(/^-+/, '')) || /(^|\s)(--dry-run)(\s|$)/.test(seg) || /-whatif\b/i.test(flags)) continue;

    // 外发类（不变）
    for (const pat of EXTERNAL_HEADS) {
      if (pat.every((re, i) => re.test([head, ...rest][i] || ''))) {
        verdict = { kind: 'external', msg: `[ask-first 外发门禁] 检出对外发布/不可逆外发（${[head, ...rest].slice(0, pat.length).join(' ')}）。按 AGENTS.md 先经用户确认（AskUserQuestion 批次或用户明示/亲手执行），确认后重跑同一命令即放行。` };
      }
    }
    if (GH_API_WRITE.test(seg)) {
      verdict = { kind: 'external', msg: `[ask-first 外发门禁] 检出 gh api 写操作（-X DELETE/POST/PUT/PATCH）。先经用户确认，确认后重跑同一命令即放行。` };
    }
    if (verdict) break;

    // git 状态覆盖类（不变）
    if (head === 'git' && (rest[0] === 'reset' && /--hard/.test(flags) ||
        rest[0] === 'checkout' && (rest[1] === '--' || rest[1] === '-- ') ||
        rest[0] === 'restore' || rest[0] === 'clean' ||
        rest[0] === 'stash' && /^(drop|pop|clear)$/.test(rest[1] || '') ||
        rest[0] === 'branch' && /^-[Dd]$/.test(rest[1] || '') && /D/.test(rest[1]) ||
        rest[0] === 'tag' && /^-d$/.test(rest[1] || ''))) {
      verdict = { kind: 'mutate', msg: `[ask-first 变更门禁] git 状态覆盖命令（git ${rest[0]}）会丢弃未提交改动/引用。先 git status 看清会失去什么，确认后重跑同一命令即放行。` };
      break;
    }

    // 变更类：v4 j/h —— scratch/记忆区豁免；用户区走路径守卫（tracked 放行/untracked·非git 预存在确认）
    const guarded = (p, op) => {
      const w = toWinPath(p, cwd);
      if (!w) return null;
      const zone = zoneOf(w);
      if (zone === 'scratch' || zone === 'memory' || zone === 'unknown') return null;
      if (confirmBlocked(st, w, 'mod')) return { kind: 'confirm', msg: confirmMsg(st) }; // v4C: 新建也拦，先于 exists
      if (!exists(w)) return null; // 不存在的目标没有可丢内容
      const msg = pathGuard(st, w, op);
      return msg ? { kind: 'mutate', msg } : null;
    };
    const lastPath = () => args[args.length - 1];
    const optVal = (names) => { for (let i = 0; i < rest.length - 1; i++) { if (names.some((n) => rest[i].toLowerCase() === n || rest[i].toLowerCase().startsWith(n + ':'))) return rest[i + 1]; } return null; };
    if (head === 'rm' || head === 'unlink' || head === 'shred' || head === 'del' || PS_RM.has(head) || (head === 'git' && rest[0] === 'rm')) {
      for (const a of args.slice(head === 'git' ? 1 : 0)) {
        if (a.includes('*') || a.includes('?')) continue;
        const w = toWinPath(a, cwd);
        if (!w || zoneOf(w) === 'scratch' || zoneOf(w) === 'memory') continue;
        if (!exists(w)) continue;
        if (isDir(w)) { const g = pathGuard(st, w, 'rmdir'); if (g) { verdict = { kind: 'mutate', msg: g }; break; } continue; }
        const g = pathGuard(st, w, 'rm');
        if (g) { verdict = { kind: 'mutate', msg: g }; break; }
      }
    } else if (head === 'cp' || head === 'mv' || head === 'install' || PS_CP.has(head) || PS_MV.has(head) || (head === 'git' && rest[0] === 'mv')) {
      const dest = optVal(['-destination']) || lastPath();
      const g = guarded(dest, 'write');
      if (g) verdict = g;
    } else if (head === 'rsync') {
      const g = guarded(lastPath(), 'write');
      if (g) verdict = g;
    } else if (head === 'tee' || head === 'tee-object' || head === 'dd') {
      const t = head === 'dd' ? (rest.find((x) => x.startsWith('of=')) || '').slice(3) : (optVal(['-filepath']) || lastPath());
      const g = guarded(t, 'write');
      if (g) verdict = g;
    } else if (PS_SETCONTENT.has(head)) {
      const t = optVal(['-path', '-filepath']) || lastPath();
      const g = guarded(t, 'write');
      if (g) verdict = g;
    } else if (head === 'curl' || head === 'wget') {
      const f = head === 'curl' ? (rest[rest.indexOf('-o') + 1] || '') : (rest[rest.indexOf('-O') + 1] || '');
      const g = guarded(f, 'write');
      if (g) verdict = g;
    } else if (head === 'tar' && /(^|\s)-[a-zA-Z]*x/.test(seg)) {
      const cIdx = rest.indexOf('-C');
      const dir = cIdx >= 0 ? toWinPath(rest[cIdx + 1], cwd) : cwd;
      if (dir && nonEmpty(dir) && zoneOf(dir) === 'user') {
        const g = pathGuard(st, dir, 'rmdir');
        if (g) verdict = { kind: 'mutate', msg: g };
        else if (!gitRootOf(dir)) verdict = { kind: 'mutate', msg: `[ask-first 变更门禁] tar 解包目标目录非空且无版本管理，可能覆盖同名文件（${cIdx >= 0 ? rest[cIdx + 1] : '当前目录'}）。先看目录内容再重跑同一命令即放行。` };
      }
    } else if (head === 'unzip' && /(^|\s)-[a-zA-Z]*o/.test(seg)) {
      const dIdx = rest.indexOf('-d');
      const dir = dIdx >= 0 ? toWinPath(rest[dIdx + 1], cwd) : cwd;
      if (dir && nonEmpty(dir) && zoneOf(dir) === 'user' && !gitRootOf(dir)) {
        verdict = { kind: 'mutate', msg: `[ask-first 变更门禁] unzip -o 目标目录非空且无版本管理，可能覆盖同名文件。先看目录内容再重跑同一命令即放行。` };
      }
    }
    if (verdict) break;

    // 重定向（v4 j: scratch/记忆区豁免；用户区走路径守卫；v4C: 确认点先于 exists 检查）
    for (const t of redirectTargets(seg)) {
      const w = toWinPath(t, cwd);
      if (!w || zoneOf(w) === 'scratch' || zoneOf(w) === 'memory' || zoneOf(w) === 'unknown') continue;
      if (confirmBlocked(st, w, 'mod')) { verdict = { kind: 'confirm', msg: confirmMsg(st) }; break; }
      if (!exists(w)) continue;
      const g = pathGuard(st, w, 'write');
      if (g) { verdict = { kind: 'mutate', msg: g }; break; }
    }
    if (verdict) break;

    // 改类提醒（每类每会话一次，不变）
    const isRemind =
      (head === 'sed' && /(^|\s)-[a-zA-Z]*i/.test(seg)) ||
      (head === 'perl' && /(^|\s)-pi|^".*-pi/.test(seg)) ||
      (head === 'git' && (rest[0] === 'commit' && /--amend/.test(flags) || rest[0] === 'rebase' || rest[0] === 'filter-branch')) ||
      (head === 'git' && rest[0] === 'stash' && rest[1] === 'pop') ||
      REMIND_HEADS.has(head) && head !== 'apply';
    const remindKey = head === 'git' ? `git-${rest[0]}` : head;
    if (isRemind && !st.reminded[remindKey]) {
      st.reminded[remindKey] = true;
      remind = `[ask-first 改类提醒] ${remindKey.replace(/^git-/, 'git ')} 为就地修改：核对模式只命中预期内容（警惕过宽正则与大面积替换），跑后 diff 自查一次。`;
    }
  }

  if (verdict) {
    if (verdict.kind !== 'confirm') { // v4C: 确认点拦不走 token 重跑放行——只有用户轮解除
      if (st.confirmed[token]) { writeState(sid, st); return; } // 看过/确认过的同一命令，放行
      st.confirmed[token] = Date.now();
    } else {
      st.confirmDenies = (st.confirmDenies || 0) + 1;
    }
    writeState(sid, st);
    deny(verdict.msg);
  }
  if (remind) { writeState(sid, st); emit('PreToolUse', remind); return; }
  writeState(sid, st);
}

function onUserPromptSubmit(input) {
  const sid = input.sessionId || process.env.CLAUDE_SESSION_ID || 'unknown';
  const raw = input.prompt || '';
  const answered = /^User has answered your questions/i.test(stripEnvelope(raw)); // v4C: 问答回应是 tool_result 形态，不清 pending
  if (isAmbient(raw) || answered) { // v4 a: 不重分类不重置，只续时
    const st = readState(sid);
    if (st) { st.ts = Date.now(); writeState(sid, st); }
    return;
  }
  const p = stripEnvelope(raw);
  if (!p) return;
  if (p.length < 30 && RE_CONT.test(p)) { // v4 b: 纯 CJK 续接可命中
    const st = readState(sid);
    if (st) { st.ts = Date.now(); st.pendingConfirm = null; writeState(sid, st); } // v4C: 续接=用户回应→解除确认点
    return;
  }
  const prev = readState(sid) || {};
  const type = classify(p);
  const next = {
    taskKey: crypto.createHash('md5').update(p.slice(0, 500)).digest('hex').slice(0, 8),
    type, gateAsked: false, driftNotified: false, diagNotified: false, flipsNotified: false,
    driftCount: 0, driftOutcome: null,
    created: prev.created || [], confirmed: prev.confirmed || {}, reminded: prev.reminded || {},
    ts: Date.now(),
  }; // 注：旧 pendingConfirm 在重建时自然丢弃=用户轮解除
  const cm = CONFIRM_RE.exec(p); // v4C: 新指令含确认点→重新武装
  if (cm) next.pendingConfirm = { q: cm[0], ts: Date.now() };
  writeState(sid, next);
  if (type === '改' || type === '环境') emit('UserPromptSubmit', TRIO_MSG(type));
  else if (type === '计划') emit('UserPromptSubmit', PLAN_TRIO_MSG);
  else if (type === '诊断') emit('UserPromptSubmit', DIAG_TRIO_MSG);
}

function onPreToolUse(input) {
  const sid = input.sessionId || process.env.CLAUDE_SESSION_ID || 'unknown';
  const tool = input.toolName || '';
  if (tool === 'Bash') { try { onBashGate(input, sid); } catch {} return; }
  if (tool === 'AskUserQuestion') { // v4C: AI 问题文本中的确认承诺（"…你再确认"）也状态化
    try {
      const ti = input.toolInput || input.tool_input || {};
      const s = JSON.stringify(ti || {});
      const m = s && CONFIRM_ASK_RE.exec(s);
      if (m) {
        const st = readState(sid) || { pendingConfirm: null };
        if (!st.pendingConfirm) { st.pendingConfirm = { q: m[0], ts: Date.now() }; writeState(sid, st); }
      }
    } catch {}
    return;
  }
  if (tool !== 'Edit' && tool !== 'Write' && tool !== 'NotebookEdit') return;
  const st = readState(sid) || { taskKey: 'adhoc', type: 'unknown', gateAsked: false, driftNotified: false, diagNotified: false, flipsNotified: false, driftCount: 0, created: [], confirmed: {}, ts: Date.now() };
  const ti = input.toolInput || input.tool_input || {};
  const fp = ti.file_path || ti.path || ti.notebook_path || '';
  const w = fp ? toWinPath(fp, input.cwd) : null;

  // v4 h: 路径守卫（写/改）
  if (w) {
    const g = pathGuard(st, w, 'write');
    if (g) { writeState(sid, st); deny(g); }
  }
  // v4C: 确认点门禁（新建也拦，不依赖 exists；不记 token，仅用户轮解除）
  const kind0 = w ? writeKind(tool, w) : 'mod';
  if (confirmBlocked(st, w, kind0)) {
    st.confirmDenies = (st.confirmDenies || 0) + 1;
    writeState(sid, st);
    deny(confirmMsg(st));
  }
  // v4 f: 漂移/对账/诊断只计修改性写
  const kind = kind0;
  if (kind !== 'mod') { writeState(sid, st); return; }
  if (st.type === '改' || st.type === '环境') {
    if (!st.gateAsked) { st.gateAsked = true; writeState(sid, st); emit('PreToolUse', GATE_MSG); return; }
  } else if (st.type === '诊断' || st.type === '计划') {
    if (!st.diagNotified) { st.diagNotified = true; writeState(sid, st); emit('PreToolUse', st.type === '计划' ? PLAN_MSG : DIAG_MSG); return; }
  } else if (st.type === 'unknown') {
    if (!st.gateAsked) { st.gateAsked = true; writeState(sid, st); emit('PreToolUse', UNKNOWN_MSG); return; }
  } else if (!st.driftNotified) {
    st.driftNotified = true;
    st.driftCount = (st.driftCount || 0) + 1;
    writeState(sid, st);
    emit('PreToolUse', DRIFT_MSG);
    return;
  }
  writeState(sid, st);
}

function onStop(input) {
  const sid = input.sessionId || process.env.CLAUDE_SESSION_ID || 'unknown';
  const st = readState(sid) || { taskKey: 'adhoc', type: 'unknown', gateAsked: false, driftNotified: false, diagNotified: false, flipsNotified: false, doneGate: false, driftCount: 0, created: [], confirmed: {}, ts: Date.now() };
  const file = path.join(ROLLOUT_DIR, `model-io-sess_${sid}.jsonl`);
  let size = 0; try { size = fs.statSync(file).size; } catch { return; }
  const start = Math.max(0, size - TAIL_BYTES);
  let buf;
  try { const fd = fs.openSync(file, 'r'); buf = Buffer.alloc(size - start); fs.readSync(fd, buf, 0, buf.length, start); fs.closeSync(fd); } catch { return; }
  const lines = buf.toString('utf8').split('\n');
  // 单次解析双用：翻转对账(v2-) + M1 完成断言(v4B)
  const segs = []; let asks = 0;
  const texts = []; const turnBash = [];
  let turnStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    let rec; try { rec = JSON.parse(lines[i]); } catch { continue; }
    const msgs = rec.request && rec.request.body && rec.request.body.messages;
    const last = Array.isArray(msgs) && msgs.length ? msgs[msgs.length - 1] : null;
    if (last && last.role === 'user') {
      const c = last.content;
      const isTR = Array.isArray(c) && c.some((b) => b && b.type === 'tool_result');
      const isText = typeof c === 'string' || (Array.isArray(c) && c.some((b) => b && b.type === 'text'));
      if (isText && !isTR) turnStart = i; // 回合边界：最后一条真实用户文本消息
    }
    const resp = rec.response;
    if (!resp) continue;
    if (resp.text) texts.push({ i, t: resp.text });
    const th = resp.reasoningText;
    if (typeof th === 'string' && th.length > 50) segs.push(th);
    for (const tc of resp.toolCalls || []) {
      const nm = (tc.function && tc.function.name) || tc.name || '';
      if (nm === 'AskUserQuestion') asks++;
      if (nm === 'Bash' && i >= turnStart) {
        const a = tc.input !== undefined ? tc.input : tc.arguments;
        const cmd = (a && typeof a === 'object' && a.command) || '';
        if (cmd) turnBash.push(cmd);
      }
    }
  }
  // v4B M1：末段完成断言（剥代码块；对冲近旁排除；同轮验证豁免；每会话一次）
  if (!st.doneGate && texts.length) {
    const inTurn = texts.filter((x) => turnStart < 0 || x.i >= turnStart);
    const finalText = (inTurn.length ? inTurn[inTurn.length - 1] : texts[texts.length - 1]).t;
    const clean = String(finalText).replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
    let m, hit = null;
    DONE_RE.lastIndex = 0;
    while ((m = DONE_RE.exec(clean))) {
      const around = clean.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40);
      if (!HEDGE_NEAR.test(around)) { hit = m[0]; break; }
    }
    const verified = turnBash.some((c) => VERIFY_RE.test(c));
    if (hit && !verified) {
      st.doneGate = true; writeState(sid, st);
      emit('Stop', M1_MSG(hit));
      return;
    }
  }
  // 翻转对账（v2- 原逻辑）
  if (st.flipsNotified) return;
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
