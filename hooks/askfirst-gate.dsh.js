// ask-first 开工三件套外置闸门 v4C-dsh（DSH 适配版，源: agent-skills/hooks/askfirst-gate.js v4C）。
// 用法: node askfirst-gate.js <UserPromptSubmit|PreToolUse|PostToolUse|Stop>
// 输入: stdin JSON（DSH claude-bridge payload: session_id/tool_name/tool_input/cwd/prompt，snake_case）。
// 输出: exit 0 + {hookSpecificOutput:{hookEventName, additionalContext}}（advisory）；
//       拦截时 stderr 写理由并 exit 2（DSH 语义: PreToolUse deny / Stop steer）。
// 任何内部错误都静默 exit 0——闸门故障不得阻塞会话（git/路径/zstd 解析失败一律放行）。
//
// 与 ZCode v4B 源的 DSH 适配点（2026-10-04 审计定稿）：
// D1. 工具名: DSH 工具为小写——write/edit/pwsh/ask_user_question（唯一 shell 工具是 pwsh）。
// D2. payload: bridge 送 tool_name/tool_input/session_id/cwd（claude 风格 snake_case）。
// D3. matcher 语义: DSH claude-code 桥的词+竖线 matcher 是字面量精确匹配（区分大小写）——
//     v2-dsh 的 "Edit|Write" 从未命中 DSH 小写工具名，漂移闸门此前在 DSH 上是死的。
// D4. advisory 通道: DSH 桥丢弃 PreToolUse/Stop 的 additionalContext（只吃 deny）——
//     advisory（三件套对账/漂移/诊断/改类提醒）改在 PostToolUse 发（additionalContext 会注入上下文）；
//     Stop 侧 M1/翻转对账用 exit 2 steer（每会话一次，steer 文本即整改要求）。
// D5. 分区表（按 DSH 会话审计）: scratch=系统tmp + ~/.dsh 根（sessions/storages/attachments/
//     usage-stats/.backups/.pideck/whale-*/dsh-bottom-info-bar——实测 AI 在 .dsh 根放工具脚本）；
//     meta=~/.dsh/{skills,hooks,profiles} + AGENTS.md + hooks.json；memory=~/.zcode/cli/memories
//     （hirame 插件两侧共享）；其余 user（含 ~/.zcode 除 memories 外——那归 ZCode 侧 hook 管）。
// D6. ambient: DSH 桥把 runtime-context/time-context/skill-catalog/agent-instructions/
//     user-approval/plugin 注入也送进 UserPromptSubmit，按已知头部特征识别不重置任务态。
// D7. 会话尾读: DSH 会话文件为 ~/.dsh/sessions/<slug>/session-<id>/session.v4.jsonl.zstd，
//     每行一个 zstd frame 追加（node zlib 只解首帧）——按 magic 扫描逐帧解压，从尾部累积到
//     预算为止。记录: user/message(data.source.kind==='user' 为真人)、assistant/message
//     (data.message.content: text/reasoning 块)、tool/call(data.name/arguments[JSON字串])。
// v4 十块与 v4B(M1) 语义与 ZCode 源一致，见 agent-skills 源码头注释 a-j + M1 段。
// v4C (确认点门禁) 语义与 ZCode 源一致，见源码头注释 v4C 段；DSH 侧工具名 ask_user_question
// 的承诺扫描挂在 onPreToolUse 的 TOOL_ASK 分支。
// v8 (2026-10-25 审计驱动) 语义与 ZCode 源一致，见源码头注释 v8 段：B1 轻提醒（UPS else 分支）+
// B2 最小完备集文案 + A2 功能文卫生 advisory（挂 onAdvisory 的 PostToolUse 通道，D4 语义；
// bridge 载荷缺 new_string/content 时 fail-open）。
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const EVENT = process.argv[2] || '';
const HOME = process.env.HOME || process.env.USERPROFILE;
const DSH_SESSIONS_DIR = process.env.ASKFIRST_DSH_SESSIONS_DIR || path.join(HOME, '.dsh', 'sessions');
const TAIL_BYTES = 256 * 1024;
const MEMDIR = path.join(HOME, '.zcode', 'cli', 'memories').toLowerCase();
const DSH_ROOT = path.join(HOME, '.dsh').toLowerCase();
const GIT_TIMEOUT = 1500;

const TOOL_WRITE = new Set(['write', 'edit', 'Write', 'Edit']); // DSH 小写为主，容 ZCode 形
const TOOL_SHELL = new Set(['pwsh', 'Bash']);
const TOOL_ASK = new Set(['ask_user_question', 'AskUserQuestion']);

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
// v4C 确认点门禁：用户流程指令中的硬停点与 AI 问题文本中的确认承诺状态化为 pendingConfirm；
// 期间用户资产写硬拦（无 token 重跑放行机制），仅真实用户轮解除（问答选项回答是 tool_result 形态，不解除）。
const CONFIRM_RE = /我再确认|等我确认|我确认一下|我过目|我拍板|先给我看|写一下我看看|我看看再|看看风格|看看.{0,8}再说|看完再|确认后再|确认之后|我看完[后再]/;
const CONFIRM_ASK_RE = /(你|我)再?确认|先给[你我]看|[你我]看看|给我看一?下/;
// D6: DSH 桥的 ambient/注入流量头部特征（会话审计: user-approval/runtime-context/time-context/
// skill-catalog/agent-instructions/plugin:meow-memory，均以固定前缀进入 prompt）。
const AMBIENT_RE = /^\s*(<system-reminder|Current runtime context|Time sampled while|The approval policy changed|Memory \(dsh-|\[meow-memory|A skill is a reusable|The following workspace instructions)/i;

// v6(D): 状态目录选址。早先写死了 ~/.dsh/hooks/state，但 DSH 把 hook 子进程放进默认
// workspace-write 沙箱（无 agent/session 的 ctx.shell 调用 → 策略取部署默认），该沙箱对
// 工作区根与系统临时目录以外的路径只给 RX；~/.dsh 带着 CodexSandboxUsers:(OI)(CI)(RX)，
// 于是每次写都是 EPERM，'每会话一次'退化成'每次都发'。
// 对策：按 cwd 优先落工作区内（一定在写白名单里），依次回退到系统临时目录、~/.dsh。
// 每个候选先做一次真实探针写，探针成功才采用——把"以为能写"变成"写通过才算数"。
const STATE_TTL_MS = 24 * 60 * 60 * 1000;   // 过期状态 24h 后清理
const STATE_DIR_CACHE = new Map();          // cwd(或'') -> 选中的目录
function stateDirCandidates(cwd) {
  const out = [];
  if (cwd && path.isAbsolute(cwd)) out.push(path.join(cwd, '.dsh-hooks-state'));
  try { out.push(path.join(os.tmpdir(), 'dsh-askfirst-state')); } catch {}
  out.push(path.join(HOME || os.homedir(), '.dsh', 'hooks', 'state'));
  return out;
}
// 会话中途才知道 cwd 的调用（UserPromptSubmit 常不带 cwd）不能让状态换目录。
// 两条发现路径：①候选目录里已有本会话状态文件；②索引文件记着上次选定的目录。
// 索引落系统临时目录——沙箱对它是可写的，且只是"指针"，丢了也能靠①重建。
function stateIndexPath(sid) {
  try { return path.join(os.tmpdir(), 'dsh-askfirst-index', String(sid).replace(/[^A-Za-z0-9._-]/g, '_') + '.txt'); } catch { return null; }
}
function readIndex(sid) {
  const p = stateIndexPath(sid);
  if (!p) return null;
  try { const d = fs.readFileSync(p, 'utf8').trim(); return d || null; } catch { return null; }
}
function writeIndex(sid, dir) {
  const p = stateIndexPath(sid);
  if (!p) return;
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, dir); } catch {}
}
function existingStateDir(sid) {
  if (!sid) return null;
  const indexed = readIndex(sid);
  if (indexed) { try { if (fs.existsSync(path.join(indexed, stateFileName(sid)))) return indexed; } catch {} }
  const name = stateFileName(sid);
  for (const dir of stateDirCandidates(LAST_CWD)) {
    try { if (fs.existsSync(path.join(dir, name))) return dir; } catch {}
  }
  return null;
}
function probeWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.probe-' + process.pid + '-' + Date.now());
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch { return false; }
}
// 目录选择按"会话"而非"cwd"记忆：同一会话里 UserPromptSubmit（无 cwd）与 PreToolUse
// （有 cwd）会看到不同的 cwd，若各选各的目录，状态就被劈成两半——读得到的写不到，写得到的
// 读不到，正是"每会话一次"失效的第二种成因。这里让每个 sid 一旦定下目录就不再改。
const SID_DIR_CACHE = new Map();
function stateDirFor(cwd, sid) {
  const key = sid ? String(sid) : '';
  if (key && SID_DIR_CACHE.has(key)) return SID_DIR_CACHE.get(key);
  let chosen = existingStateDir(sid);
  if (chosen === null) {
    for (const dir of stateDirCandidates(cwd)) {
      if (probeWritable(dir)) { chosen = dir; break; }
    }
  }
  if (chosen === null) chosen = path.join(HOME || os.homedir(), '.dsh', 'hooks', 'state'); // 全失败：保留原路径，写失败照旧可见
  if (key) SID_DIR_CACHE.set(key, chosen);
  return chosen;
}
function statePath(sid, cwd) {
  return path.join(stateDirFor(cwd), 'zcode-askfirst-' + String(sid).replace(/[^A-Za-z0-9._-]/g, '_') + '.json');
}
// 最近一次见到的会话 cwd：state 里也存一份，避免调用点全都改签名。
let LAST_CWD = '';
function noteCwd(input) {
  const c = input && (input.cwd || (input.tool_input && input.tool_input.workdir));
  if (typeof c === 'string' && path.isAbsolute(c)) LAST_CWD = c;
  return LAST_CWD;
}
function readState(sid, cwd) {
  const settled = SID_DIR_CACHE.get(String(sid));
  // 候选里必须带上 LAST_CWD（调用点普遍只传 sid），否则同一会话的两次调用会扫到不同目录集合。
  const cands = stateDirCandidates(cwd || LAST_CWD);
  const dirs = settled ? [settled, ...cands] : cands;
  for (const dir of dirs) {
    try {
      const p = path.join(dir, 'zcode-askfirst-' + String(sid).replace(/[^A-Za-z0-9._-]/g, '_') + '.json');
      const st = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (st && typeof st.ts === 'number' && Date.now() - st.ts > STATE_TTL_MS) return null;   // 过期视为无状态
      if (st && typeof st.stateDir === 'string' && st.stateDir) SID_DIR_CACHE.set(String(sid), st.stateDir);
      return st;
    } catch {}
  }
  return null;
}
function stateFileName(sid) {
  return 'zcode-askfirst-' + String(sid).replace(/[^A-Za-z0-9._-]/g, '_') + '.json';
}
// 选定目录要跨进程存活（每次 hook 调用都是新进程），所以写进 state 文件本身：
// 下一次调用 readState 从任意候选目录读到它，就能接着用同一个目录。
function writeState(sid, st) {
  const dir = stateDirFor((st && st.cwd) || LAST_CWD, sid);
  st.stateDir = dir;
  writeIndex(sid, dir);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, stateFileName(sid)), JSON.stringify(st));
    pruneStates(dir);
  } catch (e) {
    // 失败可见：状态写不进去会让'每会话一次'退化成'每次都发'，静默会让这类问题藏很久。
    try { process.stderr.write('[ask-first] state write failed (' + dir + '): ' + (e && e.message ? e.message : e) + '\n'); } catch {}
  }
}
let lastPrune = 0;
function pruneStates(dir) {
  const now = Date.now();
  if (now - lastPrune < 10 * 60 * 1000) return;   // 每 10 分钟最多清一次
  lastPrune = now;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('zcode-askfirst-') || !f.endsWith('.json')) continue;
      const fp = path.join(dir, f);
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

// v6: prompt 可能是"环境注入 + 用户话"的拼接串（DSH 首轮把 hirame/AGENTS/skill-catalog
// 快照拼在用户消息前）。逐行剥掉开头的 ambient 段，取第一段真实用户内容做分类；
// 全是 ambient 才判 ambient（保持"环境消息不重置任务态"的原语义）。
const AMBIENT_HEAD_RE = /^\s*(#\s*Memory \(dsh-|Memory \(dsh-|Current runtime context|Time sampled while|The approval policy changed|\[meow-memory|A skill is a reusable|The following workspace instructions|This session is being continued from a previous conversation)/i;
// ambient 段内特征行：空行、列表项、缩进续行、Markdown 标题、表格/键值行、代码围栏。
// 段头命中后，这些行都属于环境快照内容，整段丢弃；其它行视为真实用户话的开端。
function isAmbientBodyLine(ln) {
  if (/^\s*$/.test(ln)) return true;                         // 空行
  if (/^\s{2,}/.test(ln)) return true;                       // 缩进续行
  if (/^[\s\-*+>|]/.test(ln)) return true;                  // 列表/引用/表格
  if (/^\s*[|`]{1,3}/.test(ln)) return true;                 // 代码围栏/表格
  if (/^\s*#{1,6}\s/.test(ln)) return true;                  // Markdown 标题
  if (/^\s*<\/?[A-Za-z][^>]{0,80}>\s*$/.test(ln)) return true;    // 独立标签行
  if (/^[A-Za-z_][A-Za-z0-9_.\- ]{0,40}:/.test(ln)) return true;  // key: value（含反引号值/中文值）
  return false;
}

function stripAmbientHeads(raw) {
  // prompt = 「hirame/AGENTS/skill-catalog/runtime 快照」与「用户话」的拼接，段序不固定、无分隔符。
  // 策略：命中段头即进入 ambient 段（段内行一律丢弃），只保留段外的连续文本作为用户话。
  let s = String(raw || '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '\n')
    .replace(/<[^>]{1,200}>[^<]{0,4000}<\/[^>]{1,200}>/g, '\n');
  const lines = s.split(/\r?\n/);
  const kept = [];
  let inAmbient = false;
  for (const ln of lines) {
    if (AMBIENT_HEAD_RE.test(ln)) { inAmbient = true; continue; }
    if (inAmbient && isAmbientBodyLine(ln)) continue;
    if (inAmbient && !isUserProseLine(ln)) continue;
    inAmbient = false;
    kept.push(ln);
  }
  return kept.join('\n').trim();
}

// 用户话特征：中文句子、或含空格的自然语言句子（排除纯符号/纯路径/纯标识符）。
function isUserProseLine(ln) {
  const t = ln.trim();
  if (!t) return false;
  if (/[\u4e00-\u9fff]/.test(t)) return true;                 // 含中文
  if (t.length >= 12 && /\s/.test(t)) return true;            // 较长的英文句子
  return false;
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

// ── 分区与路径守卫（v4 h/j/f 共用机械，DSH 分区表见头注 D5） ──────────
function normWin(p) { return String(p || '').replace(/\//g, '\\').toLowerCase(); }
function zoneOf(p) {
  if (!p) return 'unknown';
  const lp = normWin(p);
  const tmp = normWin(os.tmpdir());
  if (lp === tmp || lp.startsWith(tmp + '\\')) return 'scratch';
  if (lp === DSH_ROOT || lp.startsWith(DSH_ROOT + '\\')) {
    if (/\\.dsh\\(skills|hooks|profiles)\\/.test(lp)) return 'meta';
    if (lp === path.join(DSH_ROOT, 'agents.md') || lp === path.join(DSH_ROOT, 'hooks.json')) return 'meta';
    return 'scratch'; // .dsh 根: sessions/storages/attachments/usage-stats/.backups/临时脚本
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
// 写行为分类（漂移/诊断/对账只计 'mod'）
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
  `[ask-first 确认点门禁] 用户在本轮保留了确认权（「${(st && st.pendingConfirm && st.pendingConfirm.q) || ''}」）。先把拟落笔的文件名/样张/方案贴出来等用户回复，用户回应（普通消息即可；ask_user_question 的选项回答不算）后继续；scratch/记忆区与工具脚本不受限。本拦不因重跑同一操作而放行。`;

const TRIO_MSG = (type) =>
  `[开工三件套] 本任务分类=${type}（关键词初判，模型判读可推翻）。最小完备集=交付说明开头三个短句，必给：类型：…；Done when：…；无分叉（或反问批次）。改/环境类在此之上给【任务确认】块：任务数+每项类型与对象+hook判vs模型判对照，不一致（含计划态/描述/多任务）时先 ask_user_question 质询再动手，用户裁决后写分歧台账（AGENTS.md 口径）。反问批次一次≤4题，题目只锚定 done-when 口径确认与真实分叉 A/B、范围、术语，grep 能答的先自查。`;

const DIAG_TRIO_MSG =
  `[开工三件套·诊断] 本任务分类=诊断（检查/审查/通读找问题）。①类型与对象；②Done when；③一次 ask_user_question 反问批次（≤4题，锚定口径确认与真实分叉；grep 能答的先自查），若无真分叉写明"无分叉"后开工。诊断任务默认零修改：发现问题时先报告并给修复选项，等用户点头或本轮已明示可修再动。多任务先在【任务确认】块拆分（任务数+hook判vs模型判对照，不一致先质询）。`;

const PLAN_TRIO_MSG =
  `[开工三件套·计划] 本任务分类=计划（计划态：用户宣布意图，本轮不动手）。只做只读核查与方案讨论；交付说明开头给【任务确认】块：任务数+每项类型与对象+hook判vs模型判对照（不一致→先质询）。禁止编辑落笔与执行确认式反问（"删除范围选哪个"这类把执行当既定事实的提问）；用户显式下令（删吧/动手/按清单执行）才进入执行，且只授权被点名的部分。`;

const PLAN_MSG =
  `[计划态纪律] 本任务为计划态（用户宣布意图），刚才的写入属于修改性操作。回到只读核查与方案讨论，或取得用户显式执行指令后继续；本次已记录，站会审计可见。`;

const DIAG_MSG =
  `[诊断纪律] 本任务为诊断/审查，刚才的写入属于修改性操作。默认零修改：要修复先给选项征得同意（或用户本轮已明示可修后继续）；本次已记录，站会审计可见。`;

const UNKNOWN_MSG =
  `[三件套对账] 本任务开工时类型未明（unknown），现在首次落笔修改。把类型更正为"读并改"并补全三件套声明（类型/Done when/反问批次），确无分叉则写明"无分叉"后继续；本次已记录。`;

// v8(B1) 轻提醒：unknown/读/检索/描述在 UPS 环节历史上零注入（10-25 审计：该桶 39% 整段缺失三件套）。
const MIN_TRIO_MSG = (type) =>
  `[开工三件套·轻] 本任务分类=${type}。此类轮次历史上最易整段缺失三件套。交付说明开头给最小完备集一行：类型+Done when+无分叉；豁免反问批次（有真分叉仍问）。若本条实为数据投喂/纯追问可忽略；若实际含修改意图，按"读并改"补全三件套再动手。`;

// v8(A2) 功能文卫生：user 区 prose 落笔扫"祈使负向且同句无正向替代"（审计实证形态："不要xxx"）。
// advisory 不拦断；规则/模板/变更记录类豁免；每文件每会话至多一次；内容缺失或非字符串 fail-open。
// 人味文（博客/日记/个人站）不适用——边界见 memory-hygiene skill「Scope boundary」。
const PROSE_EXT_RE = /\.(md|markdown|txt|rst|adoc)$/i;
const PROSE_RULES_RE = /(?:^|[/\\])(?:AGENTS|CLAUDE|QWEN)\.md$|(?:^|[/\\])SKILL\.md$|(?:^|[/\\])CHANGELOG[\w.-]*$|[\\/](?:templates|node_modules|\.ctx)[\\/]/i;
const PROSE_NEG_RE = /(?:^|[。；;!！？\n])(?:（[^）]{0,20}）)?(?:请)?(?:不要|请勿|勿|切忌|不得|严禁|禁止)(?=[\u4e00-\u9fffA-Za-z])/g;
const PROSE_POSITIVE_RE = /(应当|应该|建议|推荐|改为|改用|换成|请用|请改|请通过|请使用|请按|直接(用|在|交给|调用)|统一(用|在|交)|一律(用|在)|优先(用|在|选)|可以用|可通过|需要时再)/;
const PROSE_MSG = (hit) =>
  `[功能文卫生] 本文件属功能文（README/计划/报告类 prose），检出祈使负向且同句缺正向替代：「${hit}」。改写为正向做法优先、负向例外同句成对；规则/清单类的合法负向可忽略本条；人味文（博客/日记/个人站）不适用。每文件至多提醒一次。`;
function proseGuard(st, w, content) {
  if (!w || !content || typeof content !== 'string') return null;
  const key = normWin(w);
  if (!PROSE_EXT_RE.test(key) || PROSE_RULES_RE.test(key)) return null;
  st.proseReminded = st.proseReminded || {};
  if (st.proseReminded[key]) return null;
  PROSE_NEG_RE.lastIndex = 0;
  let m;
  while ((m = PROSE_NEG_RE.exec(content))) {
    let s0 = 0;
    const delims = ['\n', '。', '；', '！', '？', ';', '!', '?'];
    for (const d of delims) { const i = content.lastIndexOf(d, m.index - 1); if (i >= s0) s0 = i + 1; }
    let s1 = content.length;
    for (const d of delims) { const i = content.indexOf(d, m.index + m[0].length); if (i >= 0 && i < s1) s1 = i; }
    const sent = content.slice(s0, Math.min(s1, m.index + 160));
    if (!PROSE_POSITIVE_RE.test(sent)) {
      st.proseReminded[key] = Date.now();
      return content.slice(m.index, m.index + 30).trim();
    }
  }
  return null;
}

const DRIFT_MSG =
  `[类型漂移·留痕] 本任务声明为读/检索/描述，现在落笔修改。把类型更正为"读并改"，声明"无新分叉"或补一次反问批次（锚定 done-when 口径与真实分叉；grep 能答的先自查）。本次漂移已记录（driftCount+1，站会审计可见）。`;

const GATE_MSG =
  `[三件套对账] 本任务尚未见反问批次。落笔前发一次 ask_user_question（锚定 done-when 口径与真实分叉），或在回复开头补全三件套声明；若确无分叉，写明"无分叉"后继续。`;

const FLIP_MSG = (n) =>
  `[ask-first 对账] 最新思考段检测到 ${n} 个翻转信号且本任务未反问：对真实分叉发一次 ask_user_question，或写明为何无需问后收尾。`;

// v4B (M1) 完成断言证据门：窄口径完成词 + 近旁对冲排除 + 同轮验证命令豁免
const DONE_RE = /修好了|搞定了|弄好了|已修复|完成[了。]|测试(全部)?通过|绿了|问题解决|已解决|可以用了|能用了|should (now )?work|works now|is fixed|all (tests )?pass|fixed\./gi;
const HEDGE_NEAR = /可能|或许|也许|不一定|不确定|试试看|might|maybe|possibly|perhaps|not sure/i;
const VERIFY_RE = /(npm|pnpm|yarn)\s+(test|run\s+test|run\s+build)|pytest|python\s+-m\s+pytest|node\s+--test|vitest|\bjest\b|\btsc\b|cargo\s+test|\bgo\s+test\b|make\s+(test|check)|\bnode\s+[^\s&|;]*(test|verify|check|smoke)[^\s&|;]*\.(js|mjs|cjs|py)\b/i;
const M1_MSG = (w) =>
  `[M1 完成断言证据门] 本轮收尾含完成断言（命中：${w}）。完成态表述需附证据链之一：①背书的测试/命令及其实际结果；②构建产物或实测输出引用。无法实证的部分改写为"预期完成，待验证"。（同轮已含验证命令的回合不触发；每会话至多一次）`;

// v6(D) 记忆写入提醒：hirame 侧只有注入钩子、没有写入钩子，记不记全凭模型自觉。
// 实测 d5c5c75d（31 轮）plan 桶零写入；这里在 Stop 兜一次底，只在"本轮有实质落笔、
// 却没碰过记忆根下任何文件"时提醒一次，每会话至多一次。纯读轮不提醒。
const MEM_MSG =
  '[ask-first 记忆写入] 本轮有实质改动，但记忆根下没有任何文件被读写。若产生了值得跨会话保留的决策/事实/用户偏好，按 dsh-hirame 契约更新对应记忆文件并在 MEMORY.md 同步索引行；若本轮确实无可沉淀（纯排查、临时试验、已由代码或提交记录承载），忽略本条即可。';
// 能标记"本轮确实干过活"的工具：只读的不算。
const MEM_TOUCH_TOOLS = ['memWroteEdit', 'memWroteShell'];

// ── pwsh/Bash 门禁（v4B + PowerShell 别名） ────────────────────
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
// PS 常量变量展开（$env:TEMP 等）——只展开已知项，其余 fail-open
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
  noteCwd(input);
  const ti = input.tool_input || input.toolInput || {};
  const cmd = ti.command || '';
  if (!cmd) return;
  const st = readState(sid) || {};
  st.confirmed = st.confirmed || {};
  st.reminded = st.reminded || {};
  const cwd0 = ti.workdir || input.cwd || process.cwd();
  const token = crypto.createHash('md5').update(cmd).digest('hex').slice(0, 12);
  // v6(D): shell 侧足迹——命令碰过记忆根就算"本轮已处理记忆"，免得 Stop 重复提醒
  st.memWroteShell = true;
  try { if (String(cmd).toLowerCase().includes(MEMDIR)) st.memTouched = true; } catch {}

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
    // PS 参数取值：-Destination/-Path/-FilePath <v> 也算位置参数来源
    const optVal = (names) => { for (let i = 0; i < rest.length - 1; i++) { if (names.some((n) => rest[i].toLowerCase() === n || rest[i].toLowerCase().startsWith(n + ':'))) return rest[i + 1]; } return null; };

    if (head === 'cd' || head === 'set-location') { const w = toWinPath((rest[0] || '').replace(/--$/, ''), cwd); if (w) cwd = w; continue; }
    if (/dry-run|^n$/.test(flags.replace(/^-+/, '')) || /(^|\s)(--dry-run)(\s|$)/.test(seg) || /-whatif\b/i.test(flags)) continue;

    // 外发类（不变）
    for (const pat of EXTERNAL_HEADS) {
      if (pat.every((re, i) => re.test([head, ...rest][i] || ''))) {
        verdict = { kind: 'external', msg: `[ask-first 外发门禁] 检出对外发布/不可逆外发（${[head, ...rest].slice(0, pat.length).join(' ')}）。按 AGENTS.md 先经用户确认（ask_user_question 批次或用户明示/亲手执行），确认后重跑同一命令即放行。` };
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

    // 变更类：v4 j/h —— scratch/记忆区豁免；用户区走路径守卫
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
    if (PS_RM.has(head) || (head === 'git' && rest[0] === 'rm')) {
      for (const a of args.slice(head === 'git' ? 1 : 0)) {
        if (a.includes('*') || a.includes('?')) continue;
        const w = toWinPath(a, cwd);
        if (!w || zoneOf(w) === 'scratch' || zoneOf(w) === 'memory') continue;
        if (!exists(w)) continue;
        if (isDir(w)) { const g = pathGuard(st, w, 'rmdir'); if (g) { verdict = { kind: 'mutate', msg: g }; break; } continue; }
        const g = pathGuard(st, w, 'rm');
        if (g) { verdict = { kind: 'mutate', msg: g }; break; }
      }
    } else if (PS_CP.has(head) || PS_MV.has(head) || head === 'install' || head === 'rsync' || (head === 'git' && rest[0] === 'mv')) {
      const dest = optVal(['-destination']) || lastPath();
      const g = guarded(dest, 'write');
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
  writeState(sid, st);
}

// ── advisory（D4: PostToolUse 发，DSH 桥会注入 additionalContext） ──
function onAdvisory(input) {
  noteCwd(input);
  const sid = input.session_id || input.sessionId || 'unknown';
  const tool = input.tool_name || input.toolName || '';
  const ti = input.tool_input || input.toolInput || {};
  if (TOOL_SHELL.has(tool)) {
    // 改类提醒（sed -i 等）放这里：执行后提醒 diff 自查
    const st = readState(sid) || { reminded: {} };
    st.reminded = st.reminded || {};
    const seg = splitSegments(ti.command || '')[0] || '';
    const toks = tokenize(seg);
    const { head, rest } = cmdHead(toks);
    const flags = rest.filter((t) => t.startsWith('-')).join(' ');
    const isRemind =
      (head === 'sed' && /(^|\s)-[a-zA-Z]*i/.test(seg)) ||
      (head === 'perl' && /(^|\s)-pi|^".*-pi/.test(seg)) ||
      (head === 'git' && (rest[0] === 'commit' && /--amend/.test(flags) || rest[0] === 'rebase' || rest[0] === 'filter-branch')) ||
      (head === 'git' && rest[0] === 'stash' && rest[1] === 'pop') ||
      (REMIND_HEADS.has(head) && head !== 'apply');
    const remindKey = head === 'git' ? `git-${rest[0]}` : head;
    if (isRemind && !st.reminded[remindKey]) {
      st.reminded[remindKey] = true;
      writeState(sid, st);
      emit(EVENT, `[ask-first 改类提醒] ${remindKey.replace(/^git-/, 'git ')} 为就地修改：核对模式只命中预期内容（警惕过宽正则与大面积替换），跑后 diff 自查一次。`);
    } else writeState(sid, st);
    return;
  }
  if (!TOOL_WRITE.has(tool)) return;
  const st = readState(sid) || { taskKey: 'adhoc', type: 'unknown', gateAsked: false, driftNotified: false, diagNotified: false, flipsNotified: false, driftCount: 0, created: [], confirmed: {}, ts: Date.now() };
  const fp = ti.file_path || ti.path || ti.notebook_path || '';
  const w = fp ? toWinPath(fp, input.cwd) : null;
  // v4 f: 漂移/对账/诊断只计修改性写
  const kind = w ? writeKind(tool, w) : 'mod';
  if (kind !== 'mod') { writeState(sid, st); return; }
  if (st.type === '改' || st.type === '环境') {
    if (!st.gateAsked) { st.gateAsked = true; writeState(sid, st); emit(EVENT, GATE_MSG); return; }
  } else if (st.type === '诊断' || st.type === '计划') {
    if (!st.diagNotified) { st.diagNotified = true; writeState(sid, st); emit(EVENT, st.type === '计划' ? PLAN_MSG : DIAG_MSG); return; }
  } else if (st.type === 'unknown') {
    if (!st.gateAsked) { st.gateAsked = true; writeState(sid, st); emit(EVENT, UNKNOWN_MSG); return; }
  } else if (!st.driftNotified) {
    st.driftNotified = true;
    st.driftCount = (st.driftCount || 0) + 1;
    writeState(sid, st);
    emit(EVENT, DRIFT_MSG);
    return;
  }
  // v8(A2) 功能文卫生 advisory（PostToolUse 发；bridge 载荷缺 new_string 时 fail-open）
  if (w) {
    const hit = proseGuard(st, w, ti.content || ti.new_string || ti.newText || '');
    if (hit) { writeState(sid, st); emit(EVENT, PROSE_MSG(hit)); return; }
  }
  writeState(sid, st);
}

function onUserPromptSubmit(input) {
  const sid = input.session_id || input.sessionId || 'unknown';
  noteCwd(input);
  const raw = input.prompt || '';
  const answered = /^User has answered your questions/i.test(stripEnvelope(raw)); // v4C: 问答回应是 tool_result 形态，不清 pending
  const p = stripAmbientHeads(raw);   // v6: 剥掉 ambient 前缀，取出真实用户话；全 ambient 时为空
  if (!p || isAmbient(p) || answered) { // v4 a + D6: 不重分类不重置，只续时
    const st = readState(sid);
    if (st) { st.ts = Date.now(); writeState(sid, st); }
    return;
  }
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
    driftCount: 0, driftOutcome: null, doneGate: false,
    created: prev.created || [], confirmed: prev.confirmed || {}, reminded: prev.reminded || {},
    proseReminded: prev.proseReminded || {},
    ts: Date.now(),
  }; // 注：旧 pendingConfirm 在重建时自然丢弃=用户轮解除
  const cm = CONFIRM_RE.exec(p); // v4C: 新指令含确认点→重新武装
  if (cm) next.pendingConfirm = { q: cm[0], ts: Date.now() };
  writeState(sid, next);
  if (type === '改' || type === '环境') emit(EVENT, TRIO_MSG(type));
  else if (type === '计划') emit(EVENT, PLAN_TRIO_MSG);
  else if (type === '诊断') emit(EVENT, DIAG_TRIO_MSG);
  else emit(EVENT, MIN_TRIO_MSG(type)); // v8(B1): unknown/读/检索/描述 收轻提醒
}

function onPreToolUse(input) {
  const sid = input.session_id || input.sessionId || 'unknown';
  noteCwd(input);
  const tool = input.tool_name || input.toolName || '';
  if (TOOL_ASK.has(tool)) {
    const st = readState(sid) || { gateAsked: true, ts: Date.now() };
    st.gateAsked = true;
    const s = JSON.stringify(input.tool_input || input.toolInput || {}); // v4C: AI 问题文本中的确认承诺（"…你再确认"）也状态化
    const m = s && CONFIRM_ASK_RE.exec(s);
    if (m && !st.pendingConfirm) st.pendingConfirm = { q: m[0], ts: Date.now() };
    writeState(sid, st);
    return;
  }
  if (TOOL_SHELL.has(tool)) { try { onBashGate(input, sid); } catch {} return; }
  // 注：shell 侧足迹在 onBashGate 内标记（那里能拿到 command 文本）
  if (!TOOL_WRITE.has(tool)) return;
  const st = readState(sid) || { taskKey: 'adhoc', type: 'unknown', gateAsked: false, driftNotified: false, diagNotified: false, flipsNotified: false, driftCount: 0, created: [], confirmed: {}, ts: Date.now() };
  const ti = input.tool_input || input.toolInput || {};
  const fp = ti.file_path || ti.path || ti.notebook_path || '';
  const w = fp ? toWinPath(fp, input.cwd) : null;

  // v6(D): 记下"本轮碰过记忆根"（记忆区写在守卫里静默放行，这里补个足迹标记）
  if (w) {
    try { if (zoneOf(w) === 'memory') st.memTouched = true; } catch {}
    st.memWroteEdit = true;
  }
  // v4 h: 路径守卫（写/改）——PreToolUse 硬拦
  if (w) {
    const g = pathGuard(st, w, 'write');
    if (g) { writeState(sid, st); deny(g); }
  }
  // v4C: 确认点门禁（新建也拦，不依赖 exists；不记 token，仅用户轮解除）
  if (confirmBlocked(st, w, w ? writeKind(tool, w) : 'mod')) {
    st.confirmDenies = (st.confirmDenies || 0) + 1;
    writeState(sid, st);
    deny(confirmMsg(st));
  }
  writeState(sid, st);
}

// ── D7: DSH 会话尾读 ──────────────────────────────────────────
function findSessionFile(sid) {
  try {
    const uuid = String(sid).replace(/^session-/, '');
    for (const slug of fs.readdirSync(DSH_SESSIONS_DIR, { withFileTypes: true })) {
      if (!slug.isDirectory()) continue;
      const slugDir = path.join(DSH_SESSIONS_DIR, slug.name);
      for (const sub of fs.readdirSync(slugDir, { withFileTypes: true })) {
        if (!sub.isDirectory()) continue;
        if (sub.name !== uuid && sub.name !== 'session-' + uuid && !sub.name.endsWith(uuid)) continue;
        for (const f of ['session.v4.jsonl.zstd', 'session.v4.jsonl', 'session.jsonl.zstd', 'session.jsonl']) {
          const p = path.join(slugDir, sub.name, f);
          if (fs.existsSync(p)) return p;
        }
      }
    }
  } catch {}
  return null;
}
// 每行一个 zstd frame 的尾读：magic 扫描找 frame 边界，从尾部逐帧解压累积到预算。
// 注：magic 字节串理论上可能出现在压缩数据内造成假边界→该帧解压失败被跳过（只影响审计特征，fail-open）。
function readSessionTail(file, budget) {
  const buf = fs.readFileSync(file);
  if (buf.length < 4 || !(buf[0] === 0x28 && buf[1] === 0xB5 && buf[2] === 0x2F && buf[3] === 0xFD)) {
    // 未压缩 JSONL：直接取尾部
    const start = Math.max(0, buf.length - budget);
    return buf.subarray(start).toString('utf8');
  }
  if (typeof zlib.zstdDecompressSync !== 'function') return '';
  const offs = [];
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf[i] === 0x28 && buf[i + 1] === 0xB5 && buf[i + 2] === 0x2F && buf[i + 3] === 0xFD) offs.push(i);
  }
  const parts = [];
  let acc = 0;
  for (let j = offs.length - 1; j >= 0 && acc < budget; j--) {
    const end = j + 1 < offs.length ? offs[j + 1] : buf.length;
    try { const t = zlib.zstdDecompressSync(buf.subarray(offs[j], end)).toString('utf8'); parts.push(t); acc += t.length; }
    catch {}
  }
  return parts.reverse().join('');
}

function onStop(input) {
  const sid = input.session_id || input.sessionId || 'unknown';
  noteCwd(input);
  const st = readState(sid) || { taskKey: 'adhoc', type: 'unknown', gateAsked: false, driftNotified: false, diagNotified: false, flipsNotified: false, doneGate: false, driftCount: 0, created: [], confirmed: {}, ts: Date.now() };
  const file = findSessionFile(sid);
  if (!file) return;
  let text;
  try { text = readSessionTail(file, TAIL_BYTES); } catch { return; }
  // 单次解析双用：翻转对账(v2-) + M1 完成断言(v4B)
  const segs = []; let asks = 0;
  const texts = []; const turnBash = [];
  let userSeq = -1; // 真人用户边界：最后一条 source.kind==='user' 的 user/message
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    const seq = typeof rec.seq === 'number' ? rec.seq : 0;
    if (rec.type === 'user/message') {
      const src = rec.data && rec.data.source;
      if (src && src.kind === 'user') userSeq = seq;
      continue;
    }
    if (rec.type === 'tool/call') {
      const nm = (rec.data && rec.data.name) || '';
      if (TOOL_ASK.has(nm)) asks++;
      if (TOOL_SHELL.has(nm) && seq > userSeq) {
        let a = rec.data.arguments;
        if (typeof a === 'string') { try { a = JSON.parse(a); } catch { a = null; } }
        const cmd = (a && typeof a === 'object' && a.command) || '';
        if (cmd) turnBash.push(cmd);
      }
      continue;
    }
    if (rec.type === 'assistant/message') {
      const content = rec.data && rec.data.message && rec.data.message.content;
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        if (b.type === 'text' && b.text) texts.push({ seq, t: b.text });
        if (b.type === 'reasoning' && typeof b.text === 'string' && b.text.length > 50) segs.push(b.text);
      }
    }
  }
  // v4B M1：末段完成断言（剥代码块；对冲近旁排除；同轮验证豁免；每会话一次）
  if (!st.doneGate && texts.length) {
    const inTurn = texts.filter((x) => userSeq < 0 || x.seq > userSeq);
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
      deny(M1_MSG(hit)); // D4: Stop 侧 additionalContext 被桥丢弃，用 exit 2 steer 达成"补证据"
    }
  }
  // 翻转对账（v2- 原逻辑，同样 steer）
  if (!st.flipsNotified && asks === 0 && segs.length > 0) {
    const last = countFlips(segs[segs.length - 1]);
    const prev = countFlips(segs[segs.length - 2] || '');
    if (last >= 5 || (last >= 3 && prev >= 3)) {
      st.flipsNotified = true; writeState(sid, st);
      deny(FLIP_MSG(last));
      return;
    }
  }
  // v6(D) 记忆写入提醒：hirame 只有注入、没有写入钩子，写不写全凭模型自觉（实测 d5c5c75d
  // 31 轮零记忆操作）。这里在 Stop 侧兜一次底：本轮有实质改动、却没碰过记忆根下的任何文件
  // 时提醒一次。每会话至多一次；纯读轮不提醒（读任务无终态可记）。
  if (st.memNotified || !st.gateAsked) return;   // 未开工过的轮次不提醒
  const touchedMemory = (st.memTouched === true);
  const didWork = MEM_TOUCH_TOOLS.some((n) => st[n] === true);
  if (touchedMemory || !didWork) return;
  st.memNotified = true; writeState(sid, st);
  deny(MEM_MSG);
}

(async () => {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input = {};
  try { input = JSON.parse(raw); } catch {}
  try {
    if (EVENT === 'UserPromptSubmit') onUserPromptSubmit(input);
    else if (EVENT === 'PreToolUse') onPreToolUse(input);
    else if (EVENT === 'PostToolUse') onAdvisory(input);
    else if (EVENT === 'Stop') onStop(input);
  } catch {}
  process.exit(0);
})();
