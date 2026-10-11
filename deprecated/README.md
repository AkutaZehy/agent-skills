# deprecated/

退役技能的墓碑目录。放置规则：**SKILL.md 必须改名**（如 `SKILL.md.retired`）——skills.sh 的扫描器只认
SKILL.md 文件名（SKIP_DIRS 仅 node_modules/.git/dist/build/__pycache__），改名后 `npx skills add <owner/repo>`
的选择器即不再收录本目录下的任何技能；git 历史随时可复活。

| 内容 | 退役日期 | 原因 |
|---|---|---|
| [zcode-wallet/](zcode-wallet/) | 2026-10-11 | 长期未用；核心价值（按量计费峰谷成本核算）在 Coding Plan 配额模式下无服务对象。退役前本地实跑验证 CLI 仍可用（summary/costs/price 全正常） |
| [zcode-wallet-tool/](zcode-wallet-tool/) | 2026-10-11 | 同上，zwallet CLI 本体（含价格档案 prices.json，最后条目 2026-09-24） |
