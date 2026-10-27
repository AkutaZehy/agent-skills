#!/usr/bin/env node
// 文档契约：版本叙述、例数、模板与关键行为描述必须与当前树一致。
// 用法: node test-docs.js   —— 退出码 1 = 文档漂移。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fail = 0;

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}
function ok(name, cond, extra) {
  if (cond) {
    console.log('ok ' + name);
  } else {
    fail++;
    console.log('FAIL ' + name + (extra ? ' :: ' + extra : ''));
  }
}
function has(rel, needle) {
  return read(rel).includes(needle);
}
function lacks(rel, needle) {
  return !read(rel).includes(needle);
}

// ── ask-first 版本单一源 ──
const skill = read('skills/ask-first/SKILL.md');
const frontmatter = (skill.split('---')[1] || '');
const english = skill.split('# 中文版')[0] || '';
ok('SKILL frontmatter records protocol v7', /version:\s*"7"/.test(frontmatter));
ok('SKILL states current protocol v7', skill.includes('当前协议版本：v7'));
ok('SKILL English has the minimum complete set', english.includes('minimum complete set'));
ok('SKILL Chinese has the minimum complete set', skill.includes('最小完备集'));

ok('root README names protocol v7', has('README.md', '反问协议 v7') && lacks('README.md', '反问协议 v2'));
ok('ask-first README names protocol v7', has('skills/ask-first/README.md', '反问协议 v7') && lacks('skills/ask-first/README.md', '反问协议 v2'));
ok('CHANGELOG top section is v7', /^## v7 \(2026-10-25\)/m.test(read('CHANGELOG.md')));
ok('CHANGELOG has no v8 section', !/^## v8\b/m.test(read('CHANGELOG.md')));
ok('CHANGELOG records the withdrawn v7 label', has('CHANGELOG.md', '本版原标签为 v8'));

// ── hook 头与测试台头 ──
const zHookHead = read('hooks/askfirst-gate.js').split(/\r?\n/)[0];
const dHookHead = read('hooks/askfirst-gate.dsh.js').split(/\r?\n/)[0];
ok('ZCode hook header is protocol v7', zHookHead.includes('协议 v7') && !zHookHead.includes('v2 配套'));
ok('DSH hook header is protocol v7', dHookHead.includes('协议 v7'));
ok('DSH hook usage names its own file', read('hooks/askfirst-gate.dsh.js').split(/\r?\n/)[1].includes('askfirst-gate.dsh.js'));
const dTestHead = read('hooks/test-gate.dsh.js').split(/\r?\n/)[0];
ok('DSH test usage names its own file', dTestHead.includes('test-gate.dsh.js') && !dTestHead.includes('node test-gate.js'));

// ── 例数：README 必须等于实际断言/契约项计数 ──
// 只数正常路径断言：catch 块里的 ok() 是失败兜底，不计入 pass 例数。
function countExecutableOk(src) {
  const lines = src.split(/\r?\n/);
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("ok('")) continue;
    const prev = (lines[i - 1] || '') + (lines[i - 2] || '');
    if (/catch\s*\(/.test(prev)) continue;
    n++;
  }
  return n;
}
const zTest = read('hooks/test-gate.js');
const dTest = read('hooks/test-gate.dsh.js');
const zCount = countExecutableOk(zTest);
const dCount = countExecutableOk(dTest);
const sync = read('hooks/test-sync.js');
const mustBlock = sync.match(/const MUST_EQUAL = \[([\s\S]*?)\];/);
const allowBlock = sync.match(/const ALLOWLIST = \{([\s\S]*?)\n\};/);
const mustCount = mustBlock ? (mustBlock[1].match(/'[^']+'/g) || []).length : -1;
const allowCount = allowBlock ? (allowBlock[1].match(/^\s{2}\w+:/gm) || []).length : -1;
const syncCount = mustCount + allowCount;
const readme = read('README.md');
ok('README ZCode test count matches', readme.includes('test-gate.js`（' + zCount + ' 例）'), 'actual ' + zCount);
ok('README DSH test count matches', readme.includes('test-gate.dsh.js`（' + dCount + ' 例）'), 'actual ' + dCount);
ok('README sync count matches', readme.includes('test-sync.js`（' + syncCount + ' 项'), 'actual ' + syncCount);

// ── 关键行为描述与实现一致 ──
ok('README separates DSH and ZCode state paths', has('README.md', '.dsh-hooks-state') && has('README.md', '~/.zcode/hooks/state'));
ok('publish SKILL says file symlinks are followed', has('skills/publish-privacy-alert/SKILL.md', '文件 symlink 会被跟随'));
ok('publish SKILL drops the old no-follow claim', lacks('skills/publish-privacy-alert/SKILL.md', 'symlink 不跟随'));
ok('scan.sh comment says file symlinks are followed', has('skills/publish-privacy-alert/scripts/scan.sh', 'file symlinks are followed'));
ok('templates/ask-first has the minimum complete set', has('templates/ask-first.md', '最小完备集'));
ok('templates index lists output-style', has('templates/README.md', 'output-style.md'));
ok('templates index marks zcode-wallet retired', lacks('templates/README.md', 'zcode-wallet 无需引用块') && has('templates/README.md', 'zcode-wallet 已于'));

// ── 其他 skill 的版本/描述同步 ──
ok('negafix metadata records the local patch', has('skills/negafix/SKILL.md', 'version: "1.2.1+local.1"'));
ok('negafix changelog records the local patch', has('skills/negafix/CHANGELOG.md', '1.2.1+local.1'));
ok('memory size budget uses one threshold', lacks('skills/memory-hygiene/SKILL.md', '>15KB') && has('skills/memory-hygiene/SKILL.md', '~8KB soft cap'));
ok('root README mentions shell section 11', has('README.md', '第 11 节输出落盘与批量纪律'));
ok('root README mentions test validation criteria', has('README.md', '验证口径'));
ok('root README mentions research routing', has('README.md', '检索路由'));

if (fail) {
  console.log('FAILED: ' + fail + ' doc contract check(s)');
  process.exit(1);
}
console.log('all doc contract checks passed');
