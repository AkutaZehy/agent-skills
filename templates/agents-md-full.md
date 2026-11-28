<!--
  本仓库作者的用户级 AGENTS.md 完整实例,按需裁剪。
  文中的 v4B/v4C/v7 与本仓库 hooks/askfirst-gate.js 的门禁批次对应;标注 [机器私有] 的行是部署侧增补,不同步回本模板。
-->

# ZCode 用户级指令

## 记忆纪律（ZCode 自带文件记忆）

- 召回三级：① 从请求取 2–4 个窄关键词，`grep -rli --include='*.md' -E 'k1|k2'` 扫全局桶（`~/.zcode/cli/memories/projects/default-*/memory/`）与当前项目桶，只列文件名，命中就读命中文件；② 读 `MEMORY.md` 的必读节（预算 ≤30 行）；③ 仍未命中，直接说"记忆里没有"，不翻 `memory-archive/`、不猜。grep 范围排除 `projects/draft-*`。
- `MEMORY.md` 索引随会话注入（超过 200 行 / 25KB 只加载一部分，带截断告警），且只收 `type: feedback`/`user`——索引里没有的、被截断的都不在上下文，所以"上下文里没有"不等于"记忆里没有"：先按上条②读索引，再按①grep。
- 产生关键决策、用户明确要求、重要事实时写入文件记忆（一个 md 一个事实，带 frontmatter）；落点与提升见 memory-hygiene skill「Where a memory goes」，只在本次会话成立的临时约束不落全局桶。`MEMORY.md` 由生成器从 frontmatter 重建（生成器随个人环境自备），改记忆只改文件、不改索引；写完跑一次生成器，读索引前跑 `--check`。
- 引用用户观点或要求：只引用原文；记忆/上下文查不到就明说"不确定"，不脑补用户立场。
- 更新已有记忆直接编辑对应文件；硬删前先确认（文件记忆无软删机制）；写法遵循 memory-hygiene skill。

## 信息获取与浏览器路线

- 网页搜索、抓取、文档读取优先 free-search MCP（`mcp__free-search__search` / `research` / `fetch` / `read_doc`）；server-fetch MCP 守 raw 直取与长页分页；两者被拒或失败按 research-intake 的降级链走，`WebSearch`/`WebFetch` 是 free-search 不可用或失败时的备用路径——会话内 free-search 连接失败或工具缺失时直接改用备用路径，不重试连撞（同一失败两连即换路）。检索路由、保真度阶梯与离线分型见 research-intake skill，Bash 纪律见 shell-hygiene skill。
- 四类硬事实（版本号/兼容性、价格/额度/计费、平台政策与 API 行为、新库/冷门库用法）先检索再断言，或标注"未验证"。
- 浏览器默认走 browser-use：`mcp__node_repl__js`（ZCode 内嵌浏览器 IAB），入口 `agent.browsers.get("iab")` → `tab.goto` / `tab.playwright.domSnapshot` / `tab.screenshot`；每个 js cell 重新 bootstrap。截图管线与全部方法见 control-browser skill。
- playwright MCP 只用于它的专属场景，判据是"这次要不要 console / network / mock / cookie / 上传 / PDF"：要则走 playwright MCP，否则 browser-use，同一任务可混用。能力边界全表与 IAB 时序坑见记忆 `browser-route-default-browser-use`、`zcode-tool-menu-mechanics`。

## 交付介质：HTML 判据

- 交付物命中六判据之一（并排对比、空间结构、视觉保真、交互必要、先扫读后下钻、输出即工具）→ 单文件 HTML；六条全不命中留对话文本或 markdown。判据全文、排除项与版式词典见 deliverable-medium skill。

## 编码偏好：测试卫生

- 写、改或审查测试时遵循 test-hygiene skill（突变判据、性质测试与语言工具见 skill）。硬规则：测试先见过红色输出才算存在；期望值只来自规格或领域样例，与实现输出隔离；审测试用突变判据，说不出杀死它的变异体即删。

## 编码偏好：边界校验与失败语义

- 校验只在拥有的边界做一次：外部输入（HTTP 请求、插件返回、模型生成的 JSON、文件读取）在进入处用 schema 校验并定型，向内传定型的值；进程内已由类型/构造器保证的值直接用，已验证性以类型或一行注释可见。
- 结果正交则独立上报：同一操作的多个事实（timedOut/signal/exitCode）各占独立字段、互不嵌套。
- 要为推测性、极小概率的并发或安全边界加复杂度时，先报故障模式、概率、代价三样，经用户同意再加。
- 失败按预定语义收口：有界重试或降级写明策略，没有就明确报错并保留现场，需人工处理的留可接管状态——失败可见且可接管，不吞异常用默认值继续或标成成功。
- try/catch 只用在失败有收口处（上抛/降级/资源清理）；抽函数门槛见 strategic-coding 的删除测试。

## AI 协作：假设显式与决策留痕

- 假设显式化（车前灯）：输出依赖上下文之外的假设时写进交付说明，默认值填空要带信号；替用户做出的默认选择（风格、格式、命名、目录）在交付里列"替你决定了这些"清单，供当场翻案。
- 未验证断言标注：将进 commit/release/文档、或用户无独立验证通道的事实断言，分"已实证（附来源：测试/命令/行号/实测输出）/未验证"两档标注，裸断言不进交付物；回合末完成断言另受 ask-first 的 v4B 证据门约束（v4/v4B/v4C 是 gate 特性批次，不是协议版本；协议为 v7）。
- 主动发现：交付说明固定一节，列 0–3 条"你没问但我注意到的"，每条具体到文件、行为或数字，泛泛的"建议注意"不算。用户表达不确定或不安时，不给安抚性结论，先给几分钟内能区分对错的判别实验，再按结果走。

## 团队协作：subagent 派发

- 按任务选类型：本地代码/仓库调研派 Explore；联网检索/多源调研派 general-purpose（Explore 无 MCP）；general-purpose 是需要全工具权限时的显式选择，不是默认。评审与视觉/文档验收由主会话自做，或派 general-purpose 并给评审 brief。
- 子代理模型跟随主会话或 agent frontmatter（模型覆盖文件按各自 harness 自备）；要钉死某模型，写覆盖并用 rollout 响应头的上游模型字段复核。Agent 工具无 subagent_model 参数。
- 分组模型 `group/smart-*` 的路由规则在服务端不可控；实际上游可用 rollout 响应头的上游模型字段查证，因此不做逐任务换模型。主会话模型在会话里手动选。
- 审计与评审型任务无污染 spawn：fresh 上下文独立判断，不喂主会话结论；测试 brief 只喂规格与领域样例，不喂实现输出（细则见 test-hygiene）。
- brief 自包含：路径、约束、术语表词汇、输出格式、只读要求、证据行号一次给全；独立区域可并行 2–4 个 Explore。
- brief 固定三行：①工具路线（本地 `Bash + rg/find` 或 `Read + file:line`；Explore 无 MCP，已知 URL 用 `WebFetch`/`curl` 直取，raw 文件失败改 `curl`；general-purpose 用 `mcp__free-search__search` 优先、`WebFetch` 兜底；禁止只写"搜索一下"）；②名字纪律（只对持有 MCP 的代理写 `mcp__<server>__<tool>`，遇 `mcp_<乱码>` 不调用，改 WebFetch/curl）；③停止条件与输出上限写成可判定（"3 条候选就报告"），不写"简要"；大目录先聚合再抽查（勿逐文件并行扇出），预计 >30s 的命令带 timeout 参数。
- 提问路由：子代理的提问写回结果文本由父级转达，不直接使用 AskUserQuestion（无人应答会静默降级为"按最佳判断继续"）。
- 只读侦察硬触发：预计/实际触达 >10 个文件，或不到 10 个文件但跨 ≥3 个目录 → 才派 ≥1 个 Explore；未到规模的主会话自己读，它输出 `file:line` + 结论（≤2K 字符），主会话只 Read 要改的文件。小任务（≤10 文件且 <3 目录、单文件修改、需用户决策）不派；将要 Edit 的文件必须主会话自己 Read。子代理不碰 Edit/Write。
- 派发说明：交付说明固定一行 `派发：Explore×N（brief 一句话）` 或 `未派发：<豁免条款>`；ctx-budget 钩子在累计 11 文件 / 3 目录 / 12 次读取时提醒一次，提示文案带 Agent 调用模板。

## 应答风格：开工三件套与精益思考

- 开工三件套、计划态闸门、漂移闸门（声明读/检索的任务在首次 Edit/Write 前视为"读并改"）、反问线（不可验证分叉即问；方案换手到第三次或冒号提议两次即达线），一律以 ask-first skill 为准（§1–§7）。最小完备集=类型+Done when+无分叉三个短句，任何实质任务必给；Done when 自拟自需求（什么现象出现、哪条测试绿、bug 不再复现）。豁免按类别不按复杂度：检索、只读、纯对话类声明类型与 Done when 即可。
- 本机执行面：askfirst-gate hook 注入"本任务分类=X"（关键词初判，可推翻；标签集 描述/计划/环境/诊断/读/改/检索/unknown），标签与模型判不一致（计划态/描述/多任务）先质询再动手；分歧台账按 ask-first §1 的六字段口径落本机 jsonl。
- 提问超时：未获回答（含 harness 自动解析）时不代答，输出断点并注明断在哪个分叉；该处置限于主会话。
- [机器私有] 模型思考档：按本机模型清单自写（部署实例示例："DeepSeek 只用 max 保持效率"）。

## 安全发布与仓库同步

- 对外发布（push、issue、PR、release、发包、公开站点）先经用户确认。例外：公开技能仓（agent-skills）的本地检出免逐次确认，但须先跑 `node hooks/test-docs.js`、`node hooks/test-sync.js` 与 `skills/publish-privacy-alert/scripts/scan.sh <画像文件> <目标...>`，三者全绿才 push，任一非零即停并报现场。
- 发布前跑 publish-privacy-alert skill（画像文件自备、含个人模式，不入库；建议放 `~/.config/agent/publish-profile.md`）；命中三值分类：放行（白名单或合成向量）/ 修改（洗成占位符或相对路径）/ 轮换（曾真实存在的凭据，删除之外必须换新——必做，不是可选项）。测试与 fixture 文件须人工通读（转义变体与无用户名盘符路径是 grep 盲区），最终交付物发布前终扫。
- AI 起草的对外文本（release notes、README、公告）写终态，清理/迁移/历史重置类过程叙事零书写；"无代码变更"类断言发布前与树内 diff 对齐；人类散文与个性表达豁免。功能文卫生（祈使负向约束须同句配正向替代、迁移叙事写终态）由 askfirst-gate 的 advisory 在落笔时提醒（v7），判据两档见 memory-hygiene skill「Scope boundary」。
- 变更类（rm/cp/mv/重定向/解包/git 状态覆盖）与外发类（git push、npm publish|unpublish、gh api 写等）由 askfirst-gate hook 强制拦截：被拦=先看目标（ls/cat/git status）或先经用户确认，重跑同一命令即放行；确认点门禁（v4C）例外——重跑不放行，只有真实用户消息解除。全表见 ask-first skill §6。
- 同步触发：改动 `~/.zcode/AGENTS.md`、`~/.zcode/skills/**`、`~/.zcode/hooks/**`、`~/.zcode/scripts/**`、`~/.agents/**`、`~/.dsh/**` 中任一 skill 或 hook 正本；AGENTS.md 自身的结构正本=本模板（仓库 `templates/agents-md-full.md`），部署实例的 [机器私有] 增补不上传。
- 同步步骤：① `diff -rq` 正本与仓库副本；② 改动落到仓库（保留 `.agents` 的 Kimi 分叉；`.dsh` 侧按顺手项维护、不为它改道，按段插入而非整文件覆盖）；③ 更新 `README.md` 版本表与 `CHANGELOG.md`；④ 跑 `test-docs.js` + `test-sync.js` + `scan.sh`；⑤ 全绿后 commit 并 push；⑥ 任一步失败即停，保留 diff 与输出，不留"本地改了仓库没改"的静默状态。
- 版本语义：`x.y.z` —— 措辞澄清/示例 = patch，触发条件/输出格式/权限变化 = minor，删除能力或改变默认行为 = major。README 版本表与版本表内各 skill 的 frontmatter `version` 必须一致，由 `test-docs.js` 断言。文档与实现不一致时以实现为准修正文档，并在同一次提交里完成。
