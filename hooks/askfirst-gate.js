// ask-first 开工三件套外置闸门 v3（与 skills/ask-first v2 配套）。
// 用法: node askfirst-gate.js <UserPromptSubmit|PreToolUse|Stop>
// 安装: ./install.sh --hooks （复制本文件到 ~/.zcode/hooks/ 并合并 ZCode config.json）
// 输入: stdin JSON (ZCode hook payload)。输出: {hookSpecificOutput:{hookEventName, additionalContext}} 或空(放行)；
//       Bash 变更/外发门禁拦截时向 stderr 写理由并 exit 2（ZCode 语义：PreToolUse deny）。
// 任何内部错误都静默 exit 0——闸门故障不得阻塞会话（存在性检查解析失败一律放行）。
// v3: 补 fs require（v2 遗漏导致状态文件从未生效）；新增 Bash 门禁——
//     变更类阻断式（rm/cp/mv/重定向/解包等，hook 自查目标存在性，有东西可丢才拦，被拦的同一命令重跑放行）；
//     git 状态覆盖类阻断式（reset --hard/checkout --/restore/stash drop/clean/branch -D/tag -d）；
//     外发类全拦（git push/npm publish|unpublish/gh repo delete/gh release create|delete|upload/gh api -X 写操作）；
//     改类提醒式（sed -i/perl -pi/amend/rebase/filter-branch/stash pop/patch，每类每会话提醒一次）。
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

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
function deny(msg) {
  process.stderr.write(msg + '\n');
  process.exit(2);
}

const TRIO_MSG = (type) =>
  `[开工三件套] 本任务分类=${type}。动手前在交付说明开头给出：①类型与对象；②Done when（完成口径）；③一次 AskUserQuestion 反问批次（≤4题，题目只锚定 done-when 口径确认与真实分叉 A/B/范围/术语；grep 能答的先自查）。若无任何真分叉，明确写"无分叉"后开工。`;

const DRIFT_MSG =
  `[类型漂移] 本任务开工时声明为读/检索，现在第一次落笔修改。按 ask-first 漂移闸门：把类型更正为"读并改"，并补一次 AskUserQuestion 反问批次（锚定 done-when 口径与真实分叉；grep 能答的先自查），或声明"无新分叉"后再继续修改。`;

const GATE_MSG =
  `[三件套对账] 本任务尚未见反问批次。落笔前发一次 AskUserQuestion（锚定 done-when 口径与真实分叉），或在回复开头补全三件套声明；若确无分叉，写明"无分叉"后继续。`;

const FLIP_MSG = (n) =>
  `[ask-first 对账] 最新思考段检测到 ${n} 个翻转信号且本任务未反问：对真实分叉发一次 AskUserQuestion，或写明为何无需问后收尾。`;

// ── Bash 门禁 ───────────────────────────────────────────────
// 外发类：一律首拦（segment 首词匹配，防 grep "git push" 类误报）
const EXTERNAL_HEADS = [
  [/^git$/, /^push$/],
  [/^npm$/, /^(publish|unpublish)$/],
  [/^gh$/, /^repo$/, /^delete$/],
  [/^gh$/, /^(release|workflow-dispatch)$/, /^(create|delete|upload)$/],
];
const GH_API_WRITE = /gh\s+api\b.*\s-X\s*(DELETE|POST|PUT|PATCH)\b/i;
// git 状态覆盖类：block-first（便宜的存在性检查套不上，命令本身罕见，重跑放行）
const GIT_STATE_OVERWRITE = /^--$|^restore$|^reset$|^clean$|^stash$|^branch$|^tag$|^filter-branch$/;
// 改类提醒
const REMIND_HEADS = new Set(['sed', 'perl', 'patch', 'apply']);

function splitSegments(cmd) {
  const segs = [];
  let cur = '', q = '';
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { cur += c; if (c === q) q = ''; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '&' && cmd[i + 1] === '&' || c === '|' && cmd[i + 1] === '|' || c === ';' || c === '|') { segs.push(cur); cur = ''; i++; continue; }
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
  while (i < toks.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i])) i++; // 环境变量前缀
  if (i < toks.length && /^(sudo|command|nohup|env)$/i.test(toks[i])) i++;
  const h = toks[i] || '';
  return { head: h.split('/').pop(), rest: toks.slice(i + 1) };
}
function toWinPath(p, cwd) {
  if (!p || /\$/.test(p)) return null; // 变量展开不了，放行
  p = p.replace(/[^\\]+[\\/]$/, ''); // 去尾分隔符
  if (p === '~') return HOME;
  if (p.startsWith('~/') || p.startsWith('~\\')) p = path.join(HOME, p.slice(2));
  const m = /^\/([a-zA-Z])\/(.*)$/.exec(p);
  if (m) return `${m[1].toUpperCase()}:\\${m[2]}`;
  if (/^\/tmp\b/.test(p)) p = path.join(os.tmpdir(), p.slice(4));
  if (/^[a-zA-Z]:[\\/]/.test(p)) return p;
  if (path.isAbsolute(p)) return null; // 其他 MSYS 根，转不了
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

function onBashGate(input, sid) {
  const cmd = (input.toolInput || input.tool_input || {}).command || '';
  if (!cmd) return;
  const st = readState(sid) || {};
  st.confirmed = st.confirmed || {};
  st.reminded = st.reminded || {};
  const cwd0 = input.cwd || input.workingDirectory || process.cwd();
  const token = crypto.createHash('md5').update(cmd).digest('hex').slice(0, 12);

  let verdict = null; // {kind:'external'|'mutate', msg, target}
  let remind = null;
  let cwd = cwd0;

  for (const seg of splitSegments(cmd)) {
    const toks = tokenize(seg);
    const { head, rest } = cmdHead(toks);
    const flags = rest.filter((t) => t.startsWith('-')).join(' ');
    const args = rest.filter((t) => !t.startsWith('-') || /^(\/d|\/s)$/i.test(t));

    if (head === 'cd' && rest[0]) { const w = toWinPath(rest[0].replace(/--$/, ''), cwd); if (w) cwd = w; continue; }
    if (/^dry-run$|^n$/.test(flags.replace(/^-+/, '')) || /(^|\s)(--dry-run)(\s|$)/.test(seg)) continue;

    // 外发类
    for (const pat of EXTERNAL_HEADS) {
      if (pat.every((re, i) => re.test([head, ...rest][i] || ''))) {
        verdict = { kind: 'external', msg: `[ask-first 外发门禁] 检出对外发布/不可逆外发（${[head, ...rest].slice(0, pat.length).join(' ')}）。按 AGENTS.md 先经用户确认（AskUserQuestion 批次或用户明示/亲手执行），确认后重跑同一命令即放行。` };
      }
    }
    if (GH_API_WRITE.test(seg)) {
      verdict = { kind: 'external', msg: `[ask-first 外发门禁] 检出 gh api 写操作（-X DELETE/POST/PUT/PATCH）。先经用户确认，确认后重跑同一命令即放行。` };
    }
    if (verdict) break;

    // git 状态覆盖类（block-first）
    if (head === 'git' && (rest[0] === 'reset' && /--hard/.test(flags) ||
        rest[0] === 'checkout' && (rest[1] === '--' || rest[1] === '-- ') ||
        rest[0] === 'restore' || rest[0] === 'clean' ||
        rest[0] === 'stash' && /^(drop|pop|clear)$/.test(rest[1] || '') ||
        rest[0] === 'branch' && /^-[Dd]$/.test(rest[1] || '') && /D/.test(rest[1]) ||
        rest[0] === 'tag' && /^-d$/.test(rest[1] || ''))) {
      verdict = { kind: 'mutate', msg: `[ask-first 变更门禁] git 状态覆盖命令（git ${rest[0]}）会丢弃未提交改动/引用。先 git status 看清会失去什么，确认后重跑同一命令即放行。` };
      break;
    }

    // 变更类（存在性检查，有东西可丢才拦）
    const lastPath = () => args[args.length - 1];
    if (head === 'rm' || head === 'unlink' || head === 'shred' || head === 'del' || (head === 'git' && rest[0] === 'rm')) {
      for (const a of args.slice(head === 'git' ? 1 : 0)) {
        if (a.includes('*') || a.includes('?')) continue;
        const w = toWinPath(a, cwd);
        if (exists(w)) { verdict = { kind: 'mutate', msg: `[ask-first 变更门禁] 将删除已存在目标：${a}。先看目标（ls/cat）确认可弃，再重跑同一命令即放行。` }; break; }
      }
    } else if (head === 'cp' || head === 'mv' || head === 'install' || (head === 'git' && rest[0] === 'mv')) {
      const dest = toWinPath(lastPath(), cwd);
      if (dest && exists(dest)) {
        if (isDir(dest)) {
          const srcs = args.slice(head === 'git' ? 1 : 0, args.length - 1);
          for (const s of srcs) { if (exists(path.join(dest, path.basename(s.replace(/[\\/]$/, ''))))) { verdict = { kind: 'mutate', msg: `[ask-first 变更门禁] ${head} 将覆盖已存在文件：${lastPath()}/${path.basename(s)}。先看目标再重跑同一命令即放行。` }; break; } }
        } else {
          verdict = { kind: 'mutate', msg: `[ask-first 变更门禁] ${head} 将覆盖已存在文件：${lastPath()}。先看目标（cat/ls）确认可弃，再重跑同一命令即放行。` };
        }
      }
    } else if (head === 'rsync') {
      const dest = toWinPath(lastPath(), cwd);
      if (exists(dest)) verdict = { kind: 'mutate', msg: `[ask-first 变更门禁] rsync 目标已存在：${lastPath()}。先看目标再重跑同一命令即放行。` };
    } else if (head === 'tee' || head === 'dd') {
      const t = head === 'tee' ? lastPath() : (rest.find((x) => x.startsWith('of=')) || '').slice(3);
      if (exists(toWinPath(t, cwd))) verdict = { kind: 'mutate', msg: `[ask-first 变更门禁] ${head} 将覆写已存在文件：${t}。先看目标再重跑同一命令即放行。` };
    } else if (head === 'curl' || head === 'wget') {
      const f = head === 'curl' ? (rest[rest.indexOf('-o') + 1] || '') : (rest[rest.indexOf('-O') + 1] || '');
      if (f && exists(toWinPath(f, cwd))) verdict = { kind: 'mutate', msg: `[ask-first 变更门禁] ${head} -o 目标已存在：${f}。先看目标再重跑同一命令即放行。` };
    } else if (head === 'tar' && /(^|\s)-[a-zA-Z]*x/.test(seg)) {
      const cIdx = rest.indexOf('-C');
      const dir = cIdx >= 0 ? toWinPath(rest[cIdx + 1], cwd) : cwd;
      if (nonEmpty(dir)) verdict = { kind: 'mutate', msg: `[ask-first 变更门禁] tar 解包目标目录非空，可能覆盖同名文件（${cIdx >= 0 ? rest[cIdx + 1] : '当前目录'}）。先看目录内容再重跑同一命令即放行。` };
    } else if (head === 'unzip' && /(^|\s)-[a-zA-Z]*o/.test(seg)) {
      const dIdx = rest.indexOf('-d');
      const dir = dIdx >= 0 ? toWinPath(rest[dIdx + 1], cwd) : cwd;
      if (nonEmpty(dir)) verdict = { kind: 'mutate', msg: `[ask-first 变更门禁] unzip -o 目标目录非空，可能覆盖同名文件。先看目录内容再重跑同一命令即放行。` };
    }
    if (verdict) break;

    // 重定向（>file 截断覆写；>> 追加不拦）
    for (const t of redirectTargets(seg)) {
      if (exists(toWinPath(t, cwd))) { verdict = { kind: 'mutate', msg: `[ask-first 变更门禁] > 重定向将截断已存在文件：${t}。先看目标（cat）确认可弃，再重跑同一命令即放行。` }; break; }
    }
    if (verdict) break;

    // 改类提醒（每类每会话一次）
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
    if (st.confirmed[token]) { writeState(sid, st); return; } // 看过/确认过的同一命令，放行
    st.confirmed[token] = Date.now();
    writeState(sid, st);
    deny(verdict.msg);
  }
  if (remind) { writeState(sid, st); emit('PreToolUse', remind); return; }
  writeState(sid, st);
}

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
  if (tool === 'Bash') { try { onBashGate(input, sid); } catch {} return; }
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
