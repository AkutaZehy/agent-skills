# agent-skills

给编码 agent（ZCode / Claude Code 等 SKILL.md 类 harness）的技能合集。每个 skill 一个目录，`skills/<name>/SKILL.md` 统一结构；本 README 是索引和安装总入口。仓库分层：`skills/`（技能）、`templates/`（AGENTS.md 引用块）、`hooks/`（可选的结构闸门脚本）、`deprecated/`（退役技能墓碑，SKILL.md 已改名不被收录）。

本项目由 GLM-5.3-Flash 构建。由原独立仓库 memory-hygiene / ask-first / zcode-wallet 合并而来。

## Skills 一览

| Skill | 一句话 | 兼容性 | 详细说明 |
|---|---|---|---|
| [memory-hygiene](skills/memory-hygiene/) | 给 agent 的记忆文件卫生规范：记终态别记流水账，说做什么别说别做什么；功能文（README/计划/报告）负向同句配正向+写终态，人味文豁免 | 通用 | [README](skills/memory-hygiene/README.md) |
| [ask-first](skills/ask-first/) | 反问协议 v2：开工三件套（类型/Done when/反问批次）、读→改漂移闸门、超时挂起断点（English/中文双语） | 文本通用；hook 见下 | [README](skills/ask-first/README.md) |
| [strategic-coding](skills/strategic-coding/) | 战略编码纪律：契约面做净（命名/接口/why 注释），实现面允许糙，信号驱动还债 | 通用 | [README](skills/strategic-coding/README.md) |
| [research-intake](skills/research-intake/) | 多源调研、论文与长文的高保真取材和证据提取流程 | 通用 | [SKILL](skills/research-intake/SKILL.md) |
| [publish-privacy-alert](skills/publish-privacy-alert/) | 对外发布前的隐私卫生审查：机器画像驱动扫描 + 四类核对 + 交付物终扫（数据与逻辑分离，画像仅存本机） | 通用 | [SKILL](skills/publish-privacy-alert/SKILL.md) |
| [test-hygiene](skills/test-hygiene/) | 测试卫生：红先绿后、断言只来自规格、突变判据审测试、实现与测试上下文隔离 | 通用 | [SKILL](skills/test-hygiene/SKILL.md) |
| [negafix](skills/negafix/) | 负向平行结构禁令与审计（"it's not just X, it's Y"）+ 中文功能文祈使负向（"不要xxx"须同句配正向），上游 v1.2.1 + 本地中文检测段 | 通用 | [SKILL](skills/negafix/SKILL.md) |

兼容性口径："通用"=SKILL.md 文本对任何 SKILL.md 类 harness（ZCode/dsh/Claude Code）装上即用；"仅 ZCode"=功能绑定 ZCode 的本地数据（db/rollout）。hook 的兼容性单独一节见下。

## 安装

脚本方式（拷贝到对应 harness 的技能目录，并打印 AGENTS.md 模板块；只拷贝和打印，不改你的任何文件）：

```bash
git clone https://github.com/AkutaZehy/agent-skills.git
cd agent-skills
./install.sh --zcode                     # 装到 ~/.zcode/skills/
./install.sh --dsh                       # 装到 ~/.dsh/skills/
./install.sh --claude                    # 装到 ~/.claude/skills/
SKILLS="ask-first" ./install.sh --zcode  # 只装一个
./install.sh --zcode --hooks             # 额外安装 ask-first 闸门（见下）
```

手动方式等价于对每个 harness 的技能目录 `cp -r skills/<name>`（ZCode=`~/.zcode/skills`、dsh=`~/.dsh/skills`、Claude Code=`~/.claude/skills`）。

negafix 不在默认 `SKILLS` 列表：它是第三方 skill（上游 Ihor Orlovskyi v1.2.1，MIT）加本地中文检测段的补丁版，需要时装 `SKILLS="negafix" ./install.sh --zcode`。上游出新版覆盖安装副本会丢中文段，以本仓库 `skills/negafix/` 为正本重拷。

**templates**：安装结束会打印所选 skill 的 AGENTS.md 引用块；另有 [templates/output-style.md](templates/output-style.md)——输出风格三行的正本，跨 harness 通用，贴进各 harness 的输出风格节或等价位置。

**hooks（可选，ZCode 与 dsh 双变体）**：ask-first 的结构闸门有两个 harness 变体——`hooks/askfirst-gate.js`（ZCode：装到 `~/.zcode/hooks/`，`--hooks` 自动合并进 `~/.zcode/cli/config.json`）与 `hooks/askfirst-gate.dsh.js`（DSH：装到 `~/.dsh/hooks/`，手工注册进 dsh 的 `hooks.json`）。作用：①开工/首次落笔/收尾三时刻注入（开工三件套含【任务确认】块：任务数+hook判vs模型判对照，不一致先质询 / 计划态与描述分类 / 读→改漂移 / 翻转对账 / M1 完成断言证据门）；②shell 变更/外发门禁——外发不可逆（git push、npm publish/unpublish、gh repo|release 删发、gh api 写）首拦；路径守卫按可回滚性判定（git tracked 放行、脚本区/临时/记忆放行、非 git 或未追踪的既有文件拦一次核对拼写）；git 状态覆盖首拦；确认点门禁（用户指令含硬停点或 AI 问题文本自书确认承诺时，用户区写硬拦且不因重跑放行）；就地修改提醒。被拦后**逐字重跑同一命令**即放行。v6 起针对 DSH 实机做了适配（协议版本不变）。**v6 ①** 开工注入先剥掉 prompt 里的环境前缀（hirame 记忆快照 / AGENTS 引用 / skill 目录 / runtime 快照）再分类——这些快照与用户话是同一条拼接消息，不剥就会被整条当环境流量跳过。**v6 ②** 闸门状态选址：先曾落系统临时目录（被清理后「每会话一次」归零、重复注入），后改落 `${harness}/hooks/state/`，但 DSH 把 hook 子进程放进默认 workspace-write 沙箱（无 agent/session 的 shell 调用取部署默认），该沙箱对工作区根与系统临时目录以外只给 RX——`~/.dsh` 带 `CodexSandboxUsers:(OI)(CI)(RX)`，于是写入全数 EPERM，标记同样归零。现按 cwd 优先落工作区 `<cwd>/.dsh-hooks-state`，依次回退系统临时目录、`~/.dsh/hooks/state`，每个候选先做真实探针写；目录一经选定按会话固定，并写进状态文件与临时目录索引，使不带 cwd 的调用（UserPromptSubmit）也能找回同一份状态。附带 24h 过期清理，写失败写 stderr。**v6 ③ 记忆写入提醒**：记忆插件只有注入钩子、没有写入钩子，记不记全凭模型自觉；Stop 侧兜一次底——本轮有实质落笔却没碰过记忆根时提醒一次，每会话至多一次，纯读轮不提醒。**v8（2026-10-25 审计驱动）**：①unknown/读/检索/描述轮在开工注入环节补轻提醒（历史实测 39% 轮整段缺失三件套的桶）；②开工文案以"最小完备集=类型+Done when+无分叉"为前置、全量【任务确认】块为改/环境类增强；③功能文卫生 advisory——user 区 prose（README/计划/报告类，规则文件与 .ctx 例外）落笔扫"祈使负向且同句无正向替代"，不拦断，人味文不适用。`hooks/test-gate.js`（76 例）、`hooks/test-gate.dsh.js`（84 例）、`hooks/test-sync.js`（56 项；契约面同步守卫——两变体的词表/文案/核心判定函数必须等价，有意分叉须带理由进 allowlist）。

**Claude Code 用户**：`./install.sh --claude` 装的是 skill 文本层（软规则），hook 变体未做 CC 适配。想上闸门可以 `askfirst-gate.dsh.js` 为基底自行适配——它是 claude 协议形状（snake_case payload、小写工具名），适配点：CC 的 settings.json hooks 注册格式、CC 的 advisory 走 PreToolUse 的 additionalContext（无需 DSH 的 PostToolUse 绕道）、CC 的 Stop 拦截语义。适配后建议跑一遍 test-gate.dsh.js 的用例形态自证。

zcode-wallet（技能+CLI）已于 2026-10-11 退役，见 [deprecated/](deprecated/)——其 SKILL.md 已改名 `SKILL.md.retired`，不会被 skills.sh 等收录；需要时从 git 历史或 deprecated/ 目录复活。

## 加载模型（懒加载机制）

skill 不是装上就常驻生效的，加载分四层：

1. **description 常驻** — 每会话系统提示里只有一行 name + description，这是唯一的自动触发面，靠语义匹配；
2. **正文懒加载** — SKILL.md 正文仅在模型判定相关（或 `/skill-name` 手动调用）时才进入上下文；
3. **AGENTS.md 引用兜底** — 行为类规则需要每次会话无条件在场，把 [templates/](templates/) 里的引用块贴进用户级 AGENTS.md / CLAUDE.md 即可，整段随会话进缓存后近乎零成本；
4. **工具型 skill 保持懒加载** — 查询/流程类天然事件驱动，description 触发词就是启动条件，无需常驻。

一句话：**行为规则进 AGENTS.md，操作手册留 skill 懒加载**。这套机制在 ZCode / dsh / Claude Code 等同源 harness 上行为一致：SKILL.md 格式同款，仅安装目录不同；AGENTS.md 引用块三家通用；memory 属于各 harness 本机私有态，不在本仓库范围内。

## License

MIT
