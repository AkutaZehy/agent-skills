# agent-skills

给 SKILL.md 类 harness 用的 skills / hooks / templates 合集。每个 skill 一个目录，`skills/<name>/SKILL.md` 统一结构；本 README 是技能索引，安装、hooks 注册与版本口径见 [docs/install.md](docs/install.md)，按组件的变更史见 [docs/history.md](docs/history.md)。

仓库分层：

- `skills/` — 技能本体
- `templates/` — AGENTS.md 引用块与完整实例
- `hooks/` — 可选的结构闸门脚本
- `docs/` — 安装说明与组件变更史
- `deprecated/` — 退役墓碑，改名后不被收录

作者本人是 ZCode 用户，仓库内的实测值与安装路径以 ZCode 环境为主。本项目由 GLM-5.3-Flash 构建，由原独立仓库 memory-hygiene / ask-first / zcode-wallet 合并而来。

## Skills 一览

### 卫生类——管记忆、测试、命令、文字的干净

| Skill | 功能 | 附注 | 详细说明 |
|---|---|---|---|
| [memory-hygiene](skills/memory-hygiene/) | 给 agent 的记忆文件定写作纪律：记忆会喂给之后每一个会话，写坏一句就污染一次。只记终态和可复用的坑，流水账、失败叙事、被否过程一律不进；负向指令会反向注入错误（LLM 没有抑制机制），要写就同句配正向替代。README/计划/报告这类功能文同受管辖，博客日记豁免。出处是 2026-09-13 跨 10 项目 91 个记忆文件的审计 | 版本 1.0.0 | [README](skills/memory-hygiene/README.md) |
| [test-hygiene](skills/test-hygiene/) | 遵循测试驱动开发（TDD）纪律写测试与审测试：每条测试先见红色输出再写实现，没红过的测试不算存在；期望值只来自规格与领域样例，抄实现输出写出来的只是确认器；审测试用突变判据——说不出一条测试能杀死哪个变异体就删；另有写实现与写测试的上下文隔离、验证口径（行覆盖必要不充分，e2e 要取证外部世界） | 版本 1.0.0 | [SKILL](skills/test-hygiene/SKILL.md) |
| [shell-hygiene](skills/shell-hygiene/) | Windows 上经 Git Bash 跑命令的操作手册：MSYS 会把 `/c` 改写成盘符路径、PowerShell 5.1 与 pwsh 7 写文件默认编码不同、`python -c` 引号转义是重灾区——每条坑给正例反例与本机实测值，破坏性操作先备份回滚；oneshot 六项预检；第 11 节输出落盘与批量纪律 | 版本 1.0.0；实测值来自本机 Windows/Git Bash | [README](skills/shell-hygiene/README.md) |
| [negafix](skills/negafix/) | 清除 AI 腔的文字卫生：消除"it's not just X, it's Y"式负向排比，改用正向陈述；针对中文特化——祈使负向（"不要xxx"）必须同句配正向替代，另加破折号密度与抽象名词化两段机械检测（阈值取自 152 个 rollout 实测） | 版本 1.2.1+local.2（上游 v1.2.1，MIT + 本地中文检测段） | [SKILL](skills/negafix/SKILL.md) |

### 协作与编码纪律——管 AI 何时问、怎么写、交付什么

| Skill | 功能 | 附注 | 详细说明 |
|---|---|---|---|
| [ask-first](skills/ask-first/) | 管 AI 何时问、何时动手：每个实质任务开工先报三件套（类型 / Done when / 反问批次），真实分叉立即反问而不猜，声明只读的任务一落笔就算漂移、重新过门禁，提问超时挂起留断点而非编一个继续跑。配套 ZCode 闸门 hook 把变更类命令与外发行为机械拦截——被拦后核实目标或经确认重跑即放行。反问协议 v7，中英双语 | 版本 7（协议版本）；闸门 hook 见 docs/install.md | [README](skills/ask-first/README.md) |
| [strategic-coding](skills/strategic-coding/) | 出自 Ousterhout《A Philosophy of Software Design》、按 AI 协作改写的战略编码纪律：设计精力全部投在契约面（命名、公共接口、why 注释），实现面允许糙——agent 重写实现比重读上下文便宜；重构由信号触发（名字起不出、注释说不出 why、一个行为要开 3+ 个文件），日历不打开任何重构 | 版本 1.0.0 | [README](skills/strategic-coding/README.md) |
| [deliverable-medium](skills/deliverable-medium/) | 判定交付物用什么形态：命中六条判据之一（并排对比、空间结构、视觉保真、交互必要、先扫读后下钻、输出即工具）就产出单文件 HTML（零依赖、系统字体、内联 SVG），否则留在对话文本或 markdown——短事实与对账数据不 HTML 化；附版式词典指针 | 版本 1.0.0 | [SKILL](skills/deliverable-medium/SKILL.md) |

### 调研与发布——往外取证、往外发文的关

| Skill | 功能 | 附注 | 详细说明 |
|---|---|---|---|
| [research-intake](skills/research-intake/) | 多源调研的取材纪律：优先一手源（官方文档、仓库本体、论文原文），保真度阶梯文本>图片>PDF；arXiv 优先抓 HTML 全文（表格成真 markdown），仓库用 gh cli 直取，PDF 落盘抽文本再 grep——拿到可检索文本才算第一步完成；检索路由与离线分型处理见正文 | 版本 1.0.0 | [SKILL](skills/research-intake/SKILL.md) |
| [publish-privacy-alert](skills/publish-privacy-alert/) | 对外发布（push/PR/release/发包）前的隐私关：scan.sh 确定性扫描 + 四类人工核对（身份联系/凭据密钥/基础设施拓扑/第三方权利）+ 交付物终扫。方法核心是数据与逻辑分离——skill 只装检测方法，真实标识全住在本机画像文件里永不入库；symlink 跟随扫描，盲区与"装了不等于万事大吉"写在明面 | 版本 1.0.0；画像文件自备、仅存本机 | [SKILL](skills/publish-privacy-alert/SKILL.md) |

### 效率工具

| Skill | 功能 | 附注 | 详细说明 |
|---|---|---|---|
| [ctx-batch](skills/ctx-batch/) | 独立 CLI 工具（scan / read / run / page 四个子命令），配同名 skill 使用：一次调用批量扫、读、跑，模型只见紧凑摘要，全文落 `.ctx/logs` 供分页——读 5+ 文件、跨 3+ 目录、扫大日志时省上下文；单文件或单行 grep 不用它 | 版本 1.0.0；脚本需 Python 3 | [SKILL](skills/ctx-batch/SKILL.md) |

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
