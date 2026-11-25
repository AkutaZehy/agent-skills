#!/usr/bin/env node
// bash-lint.js — Bash oneshot 预检 + 失败重试守卫（v0.1，2026-10-26）
//
// 用法:
//   node bash-lint.js PreToolUse   # R1 语法 / R2 破坏性 / R3 失败重试 / R4 目标 / R5 工具
//   node bash-lint.js PostToolUse  # 记录失败命令的 hash，供 R3 使用
//
// 纪律:
//   - 只拦截有明确证据的错误；内部异常一律放行（fail-open），不得阻塞会话。
//   - 破坏性命令首次拦截、逐字重跑放行；语法/目标/工具/重试类错误每次拦截，要求改命令。
//   - PostToolUse 的 Bash payload 没有可靠 exit_code，失败判定用 interrupted 或 stderr 强标记；
//     grep/rg 无匹配、git diff --exit-code、test、du 权限部分失败走白名单，不计失败。
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const EVENT = process.argv[2] || '';
const HOME = os.homedir();
const STATE_DIR = path.join(HOME, '.zcode', 'hooks', 'state');
const RETRY_FILE = path.join(STATE_DIR, 'bash-retry.json');
const CONFIRM_FILE = path.join(STATE_DIR, 'bash-lint-confirm.json');
const TOOL_CACHE = path.join(STATE_DIR, 'bash-tool-cache.json');
const LOG_FILE = path.join(STATE_DIR, 'bash-lint.log');
const TTL_MS = 10 * 60 * 1000;
const TOOL_TTL_MS = 60 * 60 * 1000;
const BASH = fs.existsSync('C:/Program Files/Git/bin/bash.exe') ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const PY = fs.existsSync('C:/Program Files/Python312/python.exe') ? 'C:/Program Files/Python312/python.exe' : 'python';

function log(obj) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify({ ts: Date.now(), ...obj }) + '\n');
  } catch {}
}
function deny(msg) {
  log({ deny: msg });
  process.stderr.write(msg + '\n');
  process.exit(2);
}
function readJson(file, fallback) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' ? v : fallback;
  } catch { return fallback; }
}
function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  } catch {}
}
function hash(s) {
  return crypto.createHash('md5').update(s).digest('hex').slice(0, 16);
}
function prune(map, ttl) {
  const now = Date.now();
  const out = {};
  for (const k of Object.keys(map || {})) {
    const v = map[k];
    if (v && typeof v.ts === 'number' && now - v.ts < ttl) out[k] = v;
  }
  return out;
}

// ── 命令切分（引号感知，够用即可）────────────────────────────
function splitSegments(cmd) {
  const segs = [];
  let cur = '', q = '';
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { cur += c; if (c === q) q = ''; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if ((c === '&' && cmd[i + 1] === '&') || (c === '|' && cmd[i + 1] === '|') || c === ';' || c === '|' || c === '\n' || c === '\r') {
      segs.push(cur); cur = '';
      if (c === '&' || c === '|') i++;
      continue;
    }
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
  const raw = toks[i] || '';
  const head = raw.split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();
  return { head, raw, rest: toks.slice(i + 1) };
}

// ── 路径解析（Windows 三形态）────────────────────────────────
function resolvePath(p, cwd) {
  if (!p || typeof p !== 'string') return null;
  p = p.replace(/^["']|["']$/g, '').trim();
  if (!p || p === '-' || p === '/dev/null' || /[$*?{}\[\]]/.test(p)) return null;
  if (p === '~') return HOME;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(HOME, p.slice(2));
  const m = /^\/([a-zA-Z])\/(.*)$/.exec(p);
  if (m) return `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}`;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return p;
  if (p.startsWith('/')) return null; // 未知 MSYS 路径，放行
  return path.resolve(cwd || process.cwd(), p);
}
const exists = (p) => { try { return p != null && fs.existsSync(p); } catch { return false; } };
const isDir = (p) => { try { return p != null && fs.statSync(p).isDirectory(); } catch { return false; } };

// ── R1 语法 ─────────────────────────────────────────────────
function checkBashSyntax(cmd) {
  const r = spawnSync(BASH, ['-n', '-c', cmd], { encoding: 'utf8', timeout: 5000 });
  if (r.error) return null;
  if (r.status !== 0) {
    const err = String(r.stderr || 'bash -n failed').trim().split('\n').slice(0, 4).join('\n');
    return err || 'bash -n failed';
  }
  return null;
}
function checkPyHeredoc(cmd) {
  const re = /(?:python3?|py)\s+-\s*<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\s*\r?\n([\s\S]*?)\r?\n\1\b/;
  const m = re.exec(cmd);
  if (!m) return null;
  const body = m[2];
  const tmp = path.join(os.tmpdir(), `bash-lint-${process.pid}-${Date.now()}.py`);
  try { fs.writeFileSync(tmp, body, 'utf8'); } catch { return null; }
  const r = spawnSync(PY, ['-m', 'py_compile', tmp], { encoding: 'utf8', timeout: 5000 });
  try { fs.unlinkSync(tmp); } catch {}
  if (r.status !== 0) {
    const err = String(r.stderr || 'py_compile failed').trim().split('\n').slice(-5).join('\n');
    return err || 'py_compile failed';
  }
  return null;
}

// ── R2 破坏性（askfirst-gate 已覆盖的 rm/cp/mv/git 不重复拦）──
const R2_PATTERNS = [
  [/\bfind\b[^\n|;]*-delete\b/i, 'find -delete'],
  [/\bxargs\b[^\n|;]*\brm\b/i, 'xargs rm'],
  [/\bRemove-Item\b[^\n|;]*-Recurse\b/i, 'Remove-Item -Recurse'],
  [/\bgit\s+clean\s+-[a-z]*[fd][a-z]*/i, 'git clean -fd'],
  [/\bgit\s+reset\s+--hard\b/i, 'git reset --hard'],
];
function r2Hit(cmd) {
  for (const [re, name] of R2_PATTERNS) if (re.test(cmd)) return name;
  return null;
}
function confirmOrDeny(kind, cmd, msg) {
  const token = hash(kind + '\0' + cmd);
  const all = prune(readJson(CONFIRM_FILE, {}), TTL_MS);
  if (all[token]) {
    delete all[token];
    writeJson(CONFIRM_FILE, all);
    return true;
  }
  all[token] = { ts: Date.now() };
  writeJson(CONFIRM_FILE, all);
  deny(msg);
  return false;
}

// ── R3 失败重试 ─────────────────────────────────────────────
const WHITELIST_HEADS = /^\s*(grep|egrep|rg|du|test|\[)\b/i;
function isExpectedNonZero(cmd) {
  if (WHITELIST_HEADS.test(cmd)) return true;
  if (/\bgit\s+diff\b[^\n]*--exit-code\b/.test(cmd) && !/\|\|/.test(cmd)) return true;
  return false;
}
function r3Check(cmd) {
  const all = prune(readJson(RETRY_FILE, {}), TTL_MS);
  const key = hash(cmd);
  const prev = all[key];
  if (prev && prev.failed) {
    deny('[bash-lint R3] 同一命令在 10 分钟内失败过。读 stderr 定位原因，改一个变量（路径/引号/参数）后重试；原样重跑不会变成功。');
  }
  writeJson(RETRY_FILE, all);
}

// ── R4 目标存在 ─────────────────────────────────────────────
function redirectTargets(seg) {
  const out = [];
  const re = /(?<![0-9<>&])>{1,2}\s*([^\s&|;<>]+)/g;
  let m;
  while ((m = re.exec(seg))) out.push(m[1]);
  return out;
}
function r4Check(cmd, cwd) {
  for (const seg of splitSegments(cmd)) {
    const toks = tokenize(seg);
    const { head, rest } = cmdHead(toks);
    const flags = rest.filter((t) => t.startsWith('-'));
    const args = rest.filter((t) => !t.startsWith('-'));

    if (head === 'mkdir') {
      if (flags.some((f) => /^(|-)-?p$|--parents/.test(f))) continue;
      for (const a of args) {
        const p = resolvePath(a, cwd);
        if (!p) continue;
        const parent = path.dirname(p);
        if (!exists(parent)) {
          deny(`[bash-lint R4] mkdir 的父目录不存在：${parent}\n改用 mkdir -p 或先 ls 探目标，再重跑。`);
        }
      }
    }

    if (head === 'cp' || head === 'mv' || head === 'install') {
      const real = args.filter((a) => !/^\/[A-Za-z]$/.test(a));
      if (real.length < 2) continue;
      for (const a of real.slice(0, -1)) {
        const p = resolvePath(a, cwd);
        if (p && !exists(p)) {
          deny(`[bash-lint R4] ${head} 的源不存在：${p}\n先 ls 探清路径（空格/中文/盘符），改命令后重试。`);
        }
      }
      const destRaw = real[real.length - 1];
      const dest = resolvePath(destRaw, cwd);
      if (dest) {
        const parent = isDir(dest) || /[\\/]$/.test(destRaw) ? dest : path.dirname(dest);
        if (parent && !exists(parent)) {
          deny(`[bash-lint R4] ${head} 的目标父目录不存在：${parent}\n先 mkdir -p 或 ls 探目标。`);
        }
      }
    }

    for (const t of redirectTargets(seg)) {
      const p = resolvePath(t, cwd);
      if (!p) continue;
      if (isDir(p)) deny(`[bash-lint R4] 重定向目标是目录：${p}\n换成具体文件名后重跑。`);
      const parent = path.dirname(p);
      if (!exists(parent)) {
        deny(`[bash-lint R4] 重定向目标的父目录不存在：${parent}\n先 mkdir -p 或 ls 探目标。`);
      }
    }
  }
}

// ── R5 工具可用 ─────────────────────────────────────────────
const KNOWN_TOOLS = new Set(['gh', 'npm', 'npx', 'uvx', 'python', 'python3', 'node', 'pwsh', 'powershell', 'rg', 'zstd', 'curl', 'git', 'bash', 'tar', 'unzip']);
function toolAvailable(head) {
  if (!KNOWN_TOOLS.has(head)) return true;
  const cache = prune(readJson(TOOL_CACHE, {}), TOOL_TTL_MS);
  if (cache[head] && typeof cache[head].ok === 'boolean') return cache[head].ok;
  const r = spawnSync(BASH, ['-c', `command -v -- ${head}`], { encoding: 'utf8', timeout: 1500 });
  const ok = !r.error && r.status === 0 && String(r.stdout || '').trim().length > 0;
  cache[head] = { ok, ts: Date.now() };
  writeJson(TOOL_CACHE, cache);
  return ok;
}
function r5Check(cmd) {
  for (const seg of splitSegments(cmd)) {
    const toks = tokenize(seg);
    const { head, raw } = cmdHead(toks);
    if (!head || /[\\/]/.test(raw)) continue;
    if (!toolAvailable(head)) {
      deny(`[bash-lint R5] 未找到命令：${head}\n用绝对路径或换可用工具（command -v 预检），不要原样重试。`);
    }
  }
}

// ── 主流程 ─────────────────────────────────────────────────
(async () => {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input = {};
  try { input = JSON.parse(raw); } catch { process.exit(0); }

  const tool = input.toolName || input.tool_name || '';
  if (tool !== 'Bash') process.exit(0);
  const ti = input.toolInput || input.tool_input || {};
  const cmd = String(ti.command || '');
  if (!cmd) process.exit(0);
  const cwd = input.cwd || input.workingDirectory || process.cwd();

  if (EVENT === 'PostToolUse') {
    const resp = input.toolResponse || input.tool_response || {};
    const stderr = String(resp.stderr || '');
    const interrupted = !!resp.interrupted;
    const exitCode = typeof resp.exit_code === 'number' ? resp.exit_code : undefined;
    const strong = /(Traceback \(most recent call last\)|SyntaxError|IndentationError|ModuleNotFoundError|command not found|No such file or directory|fatal:|not recognized as an internal|Permission denied|拒绝访问|不是内部或外部命令)/.test(stderr);
    let failed = interrupted || (exitCode !== undefined ? exitCode !== 0 : strong);
    if (isExpectedNonZero(cmd)) failed = false;
    const all = prune(readJson(RETRY_FILE, {}), TTL_MS);
    const key = hash(cmd);
    if (failed) all[key] = { cmd: cmd.slice(0, 500), ts: Date.now(), failed: true };
    else delete all[key];
    writeJson(RETRY_FILE, all);
    log({ event: 'PostToolUse', failed, key, head: cmd.slice(0, 80) });
    process.exit(0);
  }

  if (EVENT !== 'PreToolUse') process.exit(0);

  // R1 语法
  const synthErr = checkBashSyntax(cmd);
  if (synthErr) {
    deny(`[bash-lint R1] bash 语法预检失败，命令未执行：\n${synthErr}\n按报错修正后重跑。`);
  }
  const pyErr = checkPyHeredoc(cmd);
  if (pyErr) {
    deny(`[bash-lint R1] Python heredoc 语法预检失败，命令未执行：\n${pyErr}\n修正后重跑。`);
  }

  // R2 破坏性（首次拦，逐字重跑放行）
  const hit = r2Hit(cmd);
  if (hit) {
    confirmOrDeny('r2', cmd,
      `[bash-lint R2] 检出破坏性命令（${hit}）。先看目标（ls/git status）或加 --dry-run；确认后逐字重跑同一命令即放行。`);
  }

  // R3 失败重试
  r3Check(cmd);

  // R4 目标
  r4Check(cmd, cwd);

  // R5 工具
  r5Check(cmd);

  log({ event: 'PreToolUse', ok: true, head: cmd.slice(0, 80) });
  process.exit(0);
})().catch(() => process.exit(0));
