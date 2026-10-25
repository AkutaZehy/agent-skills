// 契约面同步守卫：ZCode 版与 DSH 版 askfirst-gate 必须共享的语义面在此断言相等；
// 有意分叉的面进 ALLOWLIST（必须带理由注释，只断言存在不断言内容）。
// 用法: node test-sync.js   —— 退出码 1 = 契约面漂移，需裁决（回流改齐 或 移入 ALLOWLIST 写理由）。
const fs = require('fs');
const path = require('path');

const A = fs.readFileSync(path.join(__dirname, 'askfirst-gate.js'), 'utf8');      // ZCode
const B = fs.readFileSync(path.join(__dirname, 'askfirst-gate.dsh.js'), 'utf8');  // DSH

// ── 契约面：两侧必须逐字等价（空白归一后） ──
const MUST_EQUAL = [
  // 分类词表（审计驱动，改一侧必须改另一侧）
  'RE_ENV', 'RE_PLAN', 'RE_DIAG', 'RE_MODIFY', 'RE_RESEARCH', 'RE_CONT',
  // v5 计划态/描述/信封（改一侧必须改另一侧）
  'RE_FUTURE', 'RE_PASTE', 'RE_ENVELOPE', 'PLAN_TRIO_MSG', 'PLAN_MSG',
  // 翻转/完成断言词表与豁免
  'FLIP_ADV', 'FLIP_CORE', 'FLIP_CN', 'DONE_RE', 'HEDGE_NEAR',
  // 注入文案（用户可见契约）
  'TRIO_MSG', 'DIAG_TRIO_MSG', 'DIAG_MSG', 'UNKNOWN_MSG', 'DRIFT_MSG', 'GATE_MSG', 'M1_MSG',
  // v8 轻提醒 + 功能文卫生（改一侧必须改另一侧）
  'MIN_TRIO_MSG', 'PROSE_EXT_RE', 'PROSE_RULES_RE', 'PROSE_NEG_RE', 'PROSE_POSITIVE_RE', 'PROSE_MSG', 'proseGuard',
  // 门禁危险词表
  'SCRIPT_DANGER', 'SCRIPT_EXEC_RE', 'VERIFY_RE',
  // PowerShell 别名集（回流后两侧等价）
  'PS_RM', 'PS_CP', 'PS_MV', 'PS_SETCONTENT',
  // 确认点门禁（v4C：词表/文案/谓词，改一侧必须改另一侧）
  'CONFIRM_RE', 'CONFIRM_ASK_RE', 'confirmMsg', 'confirmBlocked',
  // 命令词法（回流后两侧等价）
  'tokenize', 'splitSegments', 'cmdHead', 'toWinPath',
  // 核心判定函数（回滚判据/写分档/git 检查）
  'pathGuard', 'gitRootOf', 'gitTracked', 'writeKind', 'countFlips',
];
// ── 有意分叉：只断言两侧都存在（内容差异合法，理由如下） ──
const ALLOWLIST = {
  AMBIENT_RE: 'D6: 两 harness 的幽灵流量前缀不同（ZCode=websearch/浏览器块；DSH=记忆快照/AGENTS/skill 目录/runtime 等），且 DSH 另有 stripAmbientHeads 前缀剥离——它按 DSH 拼接口径切段，ZCode 的 payload 无此拼接形态',
  zoneOf: 'D5: 分区表按各自会话审计定制（.zcode 根在 ZCode=scratch、在 DSH=user——各管各的脚本之家）',
  onBashGate: '结构分叉：DSH 含 optVal 命名参数与 PostToolUse advisory 路由；行为等价性由各自 test-gate 覆盖',
  onUserPromptSubmit: 'D2/D4: payload 字段名与 advisory 通道不同',
  onPreToolUse: 'D1/D4: 工具名集合与 advisory 通道不同',
  onStop: 'D7: DSH 读 zstd 会话尾；ZCode 读 rollout JSONL 尾',
};

function extractFnBody(src, startIdx) {
  // 从 startIdx 起做花括号配对，返回整个函数体（含 function 头）
  let i = src.indexOf('{', startIdx);
  if (i < 0) return null;
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(startIdx, i + 1); }
  }
  return null;
}
function extract(src, name) {
  const constRe = new RegExp(`(?:const|let)\\s+${name}\\s*=`);
  const fnRe = new RegExp(`function\\s+${name}\\s*\\(`);
  let m = fnRe.exec(src);
  if (m) return extractFnBody(src, m.index)?.replace(/\s+/g, ' ').trim() ?? null;
  m = constRe.exec(src);
  if (!m) return null;
  const rest = src.slice(m.index + m[0].length);
  const endMarkers = [/\nfunction\s/, /\nconst\s/, /\n\/\/\s*──/, /;\s*\n/];
  let end = rest.length;
  for (const re of endMarkers) { const mm = re.exec(rest); if (mm && mm.index < end) end = mm.index; }
  return rest.slice(0, end).replace(/\s+/g, ' ').trim();
}
// 工具名是合法的 per-harness 方差：比对前把两侧的提问工具名归一为 <ASKTOOL>
function normTool(s, isDsh) {
  return s.replace(/AskUserQuestion|ask_user_question/g, '<ASKTOOL>');
}

let fail = 0, pass = 0;
const notes = [];
for (const name of MUST_EQUAL) {
  const a = extract(A, name), b = extract(B, name);
  if (a == null || b == null) { fail++; notes.push(`MISSING ${name}: zcode=${a != null} dsh=${b != null}`); continue; }
  if (normTool(a) === normTool(b)) { pass++; }
  else {
    fail++;
    notes.push(`DIVERGED ${name}:\n  zcode: ${a.slice(0, 200)}\n  dsh  : ${b.slice(0, 200)}`);
  }
}
for (const [name, reason] of Object.entries(ALLOWLIST)) {
  const a = extract(A, name), b = extract(B, name);
  if (a == null && b == null) { fail++; notes.push(`ALLOWLIST MISSING BOTH: ${name}`); continue; }
  if (a != null && b != null && a === b) notes.push(`NOTE ${name}: 两侧现已一致——可考虑移入 MUST_EQUAL（理由已失效: ${reason.slice(0, 40)}…）`);
  pass++;
}
console.log(`sync guard: ${pass} pass, ${fail} fail`);
if (notes.length) console.log(notes.join('\n'));
process.exit(fail ? 1 : 0);
