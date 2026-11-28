# agent-skills

给 SKILL.md 类 harness 用的 skills / hooks / templates 合集。每个 skill 一个目录，`skills/<name>/SKILL.md` 统一结构；本 README 是技能索引，安装、hooks 注册与版本口径见 [docs/install.md](docs/install.md)，按组件的变更史见 [docs/history.md](docs/history.md)。仓库分层：`skills/`（技能）、`templates/`（AGENTS.md 引用块）、`hooks/`（可选的结构闸门脚本）、`docs/`（安装与组件变更史）、`deprecated/`（退役墓碑，改名后不被收录）。作者本人是 ZCode 用户，仓库内的实测值与安装路径以 ZCode 环境为主。

本项目由 GLM-5.3-Flash 构建。由原独立仓库 memory-hygiene / ask-first / zcode-wallet 合并而来。

## Skills 一览

| Skill | 功能 | 详细说明 |
|---|---|---|
| [memory-hygiene](skills/memory-hygiene/) | 管理 agent 记忆文件的卫生规范：记录终态而非流水账，陈述行动而非禁令；校验功能文的负向配对与终态叙事，豁免人味散文 | [README](skills/memory-hygiene/README.md) |
| [ask-first](skills/ask-first/) | 约束提问与动手时机：声明反问协议 v7 与开工三件套（类型/Done when/反问批次），拦截读→改漂移与计划态越权，校验交叉确认与最小完备集，超时挂起留断点（English/中文双语） | [README](skills/ask-first/README.md) |
| [strategic-coding](skills/strategic-coding/) | 划分编码投入边界：打磨契约面（命名/接口/why 注释），放行实现面的粗糙，监听信号驱动还债 | [README](skills/strategic-coding/README.md) |
| [research-intake](skills/research-intake/) | 支撑多源调研：适配论文、长文与仓库三类取材，执行检索路由与保真度阶梯，分类处理离线场景 | [SKILL](skills/research-intake/SKILL.md) |
| [publish-privacy-alert](skills/publish-privacy-alert/) | 守住对外发布关：扫描机器画像驱动的内容指纹，执行四类人工核对，终扫交付物；画像仅存本机 | [SKILL](skills/publish-privacy-alert/SKILL.md) |
| [test-hygiene](skills/test-hygiene/) | 规范测试写作与审查：验证红先绿后，校验断言只来自规格，声明验证口径（覆盖必要不充分/验证世界/smoke 形态），应用突变判据剔除弱测试，隔离实现与测试上下文 | [SKILL](skills/test-hygiene/SKILL.md) |
| [negafix](skills/negafix/) | 清除 AI 腔：禁用负向平行结构（"it's not just X, it's Y"），改写中文祈使负向（"不要xxx"须同句配正向），量化破折号密度与抽象名词化；上游 v1.2.1 + 本地中文检测段（1.2.1+local.2） | [SKILL](skills/negafix/SKILL.md) |
| [shell-hygiene](skills/shell-hygiene/) | 整理 Windows/Git Bash 命令纪律：转换 MSYS 路径与三形态路径，转义引号与 heredoc，约定 Python/PowerShell 编码，区分预期退出码与真错，预检 oneshot 六项；第 11 节输出落盘与批量纪律 | [README](skills/shell-hygiene/README.md) |
| [deliverable-medium](skills/deliverable-medium/) | 判定交付介质：套用六条 HTML 判据与排除项，命中则产出单文件 HTML，否则保留对话或 markdown；查阅版式词典 | [SKILL](skills/deliverable-medium/SKILL.md) |
| [ctx-batch](skills/ctx-batch/) | 加速批量读取与检索：合并扫/读/跑为一次 CLI 调用，压缩为紧凑摘要，落盘全文到 `.ctx/logs` 供分页；单文件或单次 grep 跳过 | [SKILL](skills/ctx-batch/SKILL.md) |

## 加载模型（懒加载机制）

skill 装上后按四层加载：

1. **description 常驻** — 每会话系统提示里只有一行 name + description，这是唯一的自动触发面，靠语义匹配；
2. **正文懒加载** — SKILL.md 正文仅在模型判定相关（或 `/skill-name` 手动调用）时才进入上下文；
3. **AGENTS.md 引用兜底** — 行为类规则需要每次会话无条件在场，把 [templates/](templates/) 里的引用块贴进用户级指令文件即可，整段随会话进缓存后近乎零成本；
4. **工具型 skill 保持懒加载** — 查询/流程类天然事件驱动，description 触发词就是启动条件，无需常驻。

一句话：**行为规则进 AGENTS.md，操作手册留 skill 懒加载**。这套机制对同源的 SKILL.md 类 harness 行为一致，memory 属于各 harness 的本机私有态，不在本仓库范围内。

## 已知限制

- 文本层 skill 依赖 harness 的语义触发；description 未命中时不会自动加载，行为类规则需在用户级指令文件放引用块。
- hook 目前只有 ZCode 变体；DSH 变体已退役至 [deprecated/](deprecated/)，Claude Code 需自行适配注册格式。
- skill 的遵循度受模型与上下文位置影响；跨 harness 的 memory 是各本机私有态，不在本仓库范围。

## License

MIT
