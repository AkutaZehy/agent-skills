// 把 ask-first 闸门钩子合并进 ZCode config.json。幂等：已装的条目跳过；改前自动备份。
// 用法: node install-merge.js <config.json路径> <node可执行文件> <已安装的askfirst-gate.js路径>
const fs = require('fs');

const [cfg, nodeExe, installedScript] = process.argv.slice(2);
if (!cfg || !nodeExe || !installedScript) {
  console.error('usage: node install-merge.js <config.json> <node-exe> <installed-gate.js>');
  process.exit(1);
}

let c;
try { c = JSON.parse(fs.readFileSync(cfg, 'utf8')); }
catch (e) { console.error(`hooks: ${cfg} is not valid JSON, aborting (${e.message})`); process.exit(1); }

const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const backup = `${cfg}.bak-askfirst-${stamp}`;
fs.copyFileSync(cfg, backup);

c.hooks = c.hooks || {};
c.hooks.enabled = true;
c.hooks.events = c.hooks.events || {};

function entry(event, matcher, label) {
  const h = {
    type: 'process',
    command: nodeExe,
    args: [installedScript, event],
    timeoutMs: 3000,
    statusMessage: label || `ask-first ${event}`,
  };
  return matcher ? { matcher, hooks: [h] } : { hooks: [h] };
}

const WANT = [
  ['UserPromptSubmit', undefined, 'ask-first 开工闸门'],
  ['PreToolUse', 'AskUserQuestion|Edit|Write', 'ask-first 漂移闸门'],
  ['PreToolUse', 'Bash', 'ask-first 变更/外发闸门'],
  ['Stop', undefined, 'ask-first 对账'],
];

let added = 0, skipped = 0;
for (const [event, matcher, label] of WANT) {
  const arr = (c.hooks.events[event] = c.hooks.events[event] || []);
  const exists = arr.some(e => (e.matcher || '') === matcher && (e.hooks || []).some(h => (h.args || []).some(a => String(a).includes('askfirst-gate.js'))));
  if (exists) { skipped++; continue; }
  arr.push(entry(event, matcher, label));
  added++;
}

fs.writeFileSync(cfg, JSON.stringify(c, null, 2));
JSON.parse(fs.readFileSync(cfg, 'utf8')); // write-back sanity check
console.log(`hooks config: ${added} added, ${skipped} already present`);
console.log(`backup: ${backup}  (rollback = copy it back over ${cfg})`);
