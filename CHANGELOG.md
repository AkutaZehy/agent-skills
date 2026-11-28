# Changelog

本文件记录 agent-skills 的版本变更史。当前行为见 [README.md](README.md) 与各 skill 的 SKILL.md；本文件只回答「哪一版改了什么、为什么」。

版本轴说明：v2 / v5 / v6 / v7 是协议（行为）版本；v3 / v4 / v4B / v4C 是 hook 门禁特性批次。两者曾共用 `vN` 标号，历史节按内容判断。

## 2026-11-28 · README 瘦身重构：安装拆入 docs/，DSH 变体退役

1. **README 重写**——定位收窄为技能索引：不再枚举 harness（改述"给 SKILL.md 类 harness 用的 skills / hooks / templates 合集"，作者为 ZCode 用户一句带过），安装/hooks 细节全部移出，Skills 一览表逐行具体化（二字动词句式：管理/约束/打磨/守住/校验/量化/整理/判定/加速），删除"兼容性"列与协议口径行里的 harness 枚举。保留 test-docs 断言锚点短语（反问协议 v7、检索路由、验证口径、第 11 节输出落盘与批量纪律）。
2. **`docs/install.md`（新增）**——承接安装、hooks 注册（askfirst-gate / browser-route / bash-lint）、版本口径、Skill 版本表、zcode-wallet 退役记录；Claude Code 适配段留占位（作者自写长文后替换；旧版以 DSH 变体为基底的指引一并退役）。
3. **`docs/history.md`（新增）**——按组件归组的变更索引（skills / hooks / templates / docs 四组），时间线完整记录仍见 CHANGELOG。
4. **DSH 变体退役**——`hooks/askfirst-gate.dsh.js` 移入 `deprecated/`（纯移动，内容零改动）；`install.sh` 删除 `--dsh` 分支与 usage 行；`test-gate.dsh.js` 默认被测路径改指 deprecated 副本；`test-sync.js` 守卫指向退役副本（防误改漂移），文件头注记退役事实；`test-docs.js` 的 DSH 头断言与例数/状态路径/版本表断言重定向（README → docs/install.md，DSH 文件 → deprecated/）。skills 正文与 templates 的 dsh 兼容性提及按裁决保留。
5. **CHANGELOG 保持时间线口径**；按组件的变更索引见 docs/history.md。

## 2026-11-28 · AGENTS.md 完整实例入库：templates/agents-md-full.md（结构正本）

1. **`templates/agents-md-full.md`（新增）**——作者用户级 AGENTS.md 的发布版实例，逐节脱敏后入库：删 provider 内部型号名（"smart-split 实测落 Terra"）、机器实时状态（"agents-state 覆盖当前为空"）与个人模型配置（"DeepSeek 只用 max"，改留 `[机器私有]` 槽位示例）；`memory-index.py` 与 `browser-client.mjs` 等本机私有文件引用改为自备/指针表述；发布仓绝对盘符路径改"本仓库（agent-skills）"占位；画像路径注明自备不入库。头部两行说明实例定位与 hooks 批次对应关系。
2. **定位**：该模板为 AGENTS.md 的结构正本——部署实例（`~/.zcode/AGENTS.md`）允许携带机器私有增补，不同步回模板；部署侧同步触发条目已加对应关系句。README templates 节同步登记。
3. **复核**：publish-privacy-alert scan.sh 终扫模板文件（画像 `~/.config/agent/publish-profile.md`）；test-docs / test-sync 全绿后提交。

## 2026-11-28 · shell-hygiene PowerShell 项去版本号化与 pwsh7 优先；AGENTS.md 正本对齐

1. **`skills/shell-hygiene/SKILL.md` §1/§7**——环境事实表 PowerShell 行不再绑定具体版本号（本机 pwsh 已随更新到 7.7.0，旧表写死 7.6.7 已过期），表述改为 "`powershell` = Windows PowerShell 5.1（兼容保留）、`pwsh` = PowerShell 7.x（优先使用）"，版本随更新漂移、表内只记行为差异。§7 单行命令处方从 `powershell -NoProfile -Command` 改为 `pwsh -NoProfile -Command`（用户裁定 pwsh7 稳定性更好），并新增实测启动开销行（bash ~80ms / pwsh ~380ms / 5.1 ~270ms，Git Bash 内连续单发）——文本/文件/git 类操作留在 bash，Windows 原生 API 才进 PowerShell。`skills/shell-hygiene/README.md` 实测值句同步去版本号。本机 218 个 rollout 全量复核：cmd.exe 零调用、powershell 真实调用 8-10 次且姿势全部符合本 skill，bash-native 占比 85-93%——现有纪律已把行为塑形到位，未新增硬性 shell 规则。
2. **AGENTS.md 正本对齐（正本不入仓库，记录供对账）**——安全发布节 `scripts/scan.sh` 修正为 `skills/publish-privacy-alert/scripts/scan.sh`（仓库重构后旧路径已不存在，`hooks/test-docs.js` 一直断言新路径）；信息获取节增补 free-search 可用性前置（连接失败或工具缺失时直接走 `WebSearch`/`WebFetch` 备用路径，同一失败两连即换路）；brief 三行 §③ 增补"大目录先聚合再抽查（勿逐文件并行扇出）、预计 >30s 的命令带 timeout 参数"。依据：2026-11-28 全量 rollout 审计——free-search CONNECT_TIMEOUT 期间 GPT/Gemini 撞缺失工具形成重试环，Gemini 单响应 2556 个并行工具调用撞输出上限，GPT 系 114 次 30s 工具超时。

## 2026-11-25 · 新增 ctx-batch 与 bash-lint：批量上下文与 Bash 预检

1. **`skills/ctx-batch/`（新增）**——一次 CLI 调用完成批量扫描/读取/执行，只回紧凑摘要，全文落 `.ctx/logs` 供分页；`scan`/`read`/`run`/`page` 四个子命令，`run` 以 argv 列表执行（`shell=False`）。脚本随 skill 发布在 `scripts/ctx.py`，正文里给的是 ZCode 本机装法 `~/.zcode/bin/ctx.py`。
2. **`hooks/bash-lint.js`（新增，ZCode 单变体）**——Bash 预检与失败重试守卫五项：R1 语法（`bash -n` 与 Python heredoc 的 `py_compile`）、R2 破坏性命令（首次拦、逐字重跑放行）、R3 同命令 10 分钟内失败过则拦、R4 `mkdir`/`cp`/`mv`/`install`/重定向的目标父目录、R5 `command -v` 工具可用（1 小时缓存）。内部异常一律放行；与 askfirst-gate 的分工是路径碰撞类不重复拦。
3. **未配套测试**——`hooks/bash-lint.js` 暂无 `hooks/test-*.js` 用例；`ctx-batch` 的脚本只做过 `--help` 冒烟。两者都不被 `hooks/test-docs.js` 断言，故不影响现有检查。
4. **skill 版本无变更**；`memory-hygiene` 与 `publish-privacy-alert` 保持 1.0.0。

## 2026-11-23 · negafix 1.2.1+local.2：中文破折号密度与抽象名词化

1. **negafix 1.2.1+local.2**（上游 1.2.1 与 local.1 行为不变）——新增第二个中文检测段，两类可机械计数的 AI 腔：破折号当连接词用（≥3 次/千字符为候选）与抽象名词化（闭集词表：可验证性/确定性/结构性/颗粒度…）。
2. **阈值来自实测** —— 近一月 152 个 rollout、30 个会话，破折号每千字符频率跨 0.0-6.4、九个模型里六个在 2.8 以下，阈值取 3。
3. **为什么用闭集而非字符正则** —— `[\u4e00-\u9fff]{3,}(化|性|度)` 在同一语料命中 556 次，绝大多数是普通词（兼容性/初始化/一次性/精度/宽度），正则精度不足以进入候选集。
4. **`doc-lint.py` 新增 R8**（本机工具，不入仓库）——正文段落字数 CV < 0.5 且 ≥6 段、≥1500 字符时报告段落节奏扁平化；本地 11 份文档实测 CV 0.50-1.31，阈值零误报。

## 2026-10-30 · 浏览器路线引导 hook

1. **新增 `hooks/browser-route.js`**（ZCode 单变体）——UserPromptSubmit 时检测浏览器意图，命中则在消息尾部注入路线规则：浏览器任务默认走 browser-use（`mcp__node_repl__js` + ZCode 内嵌浏览器 IAB），playwright MCP 留给它的专属场景（console 报错捕获 / network 请求体检查 / route mock / cookie 与 storage 读写 / 文件上传 / PDF 导出 / emulate_media / run_code_unsafe），判据是"这次要不要 console / network / mock / cookie / 上传 / PDF"。用户点名 playwright 时不注入，非浏览器任务不注入，同会话至多注入一次，畸形输入静默放行。
2. **落点选择依据** —— 放在 UserPromptSubmit 尾部而非 AGENTS.md：实测尾部注入的采纳率高于首位注入（AGENTS.md 注入在 messages 首个 user 消息，离当前轮可达 250K tokens，同会话内首位的委派规则 0 次被采纳；尾部注入的 TodoWrite 提醒基本次次被采纳）。
3. **`hooks/test-browser-route.js`（21 例）** —— 覆盖命中/不命中关键词、显式点名 playwright 时的尊重、会话去重、ambient 排除、system-reminder 信封剥除、畸形与空输入的放行。
4. **skill 版本无变更**；`memory-hygiene` 与 `publish-privacy-alert` 保持 1.0.0。

## 2026-10-27 · 记忆分层、索引生成与同步 SOP

1. **memory-hygiene 1.0.0**（版本自本日起算）——新增"记忆落点三分"（全局 / 项目 / 沙箱）、提升判据（跨工作区可复用且非一次性）、索引生成契约（`MEMORY.md` 是产物，只收 `type: feedback` 与 `type: user`）、归档语义（退出索引不等于移动文件；`supersedes:` 取代时间规则）。
2. **publish-privacy-alert 1.0.0**（版本自本日起算）——新增与 magpie 出站脱敏的边界说明：值级、可逆、只覆盖过网关的流量；发布树级判定仍由本 skill 承担。
3. **工具** —— 新增 `tools/memory-index.py`（渲染 `MEMORY.md` 与 `--check`，退出码 0 一致 / 1 漂移 / 2 错误）。
4. **协作纪律** —— AGENTS.md 增加 agent-skills 同步 SOP，以及该仓库的免逐次确认发布例外：`test-docs.js`、`test-sync.js`、`scan.sh` 三者全绿才 push。

## v7 (2026-10-25)

> 本版原标签为 v8。`7a5059e` 曾把 DSH 状态修复标为 v7，`ef04dd6` 随即撤销并归入 v6，该 v7 未发布；本版回收 v7 作为协议版本。历史 commit 标签保持原样。

审计驱动的一组改动（commit `624660e`）：

1. **轻提醒** —— unknown / 读 / 检索 / 描述轮在开工注入环节补一次轻提醒。历史实测 39% 的轮次整段缺失三件套。
2. **最小完备集** —— 开工文案以「最小完备集 = 类型 + Done when + 无分叉」为前置，全量【任务确认】块作为改 / 环境类的增强。
3. **功能文卫生 advisory** —— user 区 prose（README / 计划 / 报告类，规则文件与 .ctx 例外）落笔时扫「祈使负向且同句无正向替代」，只提醒不拦断，人味文不适用。

## v6 (2026-10-15)

针对 DSH 实机的适配（协议版本仍为 v6；这批只做 DSH 适配；commit `6943c58`、`0cf3379`、`ef04dd6`、`7a5059e`）：

1. **环境前缀剥离** —— DSH 把记忆快照、AGENTS 引用、skill 目录、runtime 快照与用户话拼成同一条 prompt 送进来。闸门先按已知段头切段、丢掉环境段、只对真实用户话分类；整条都是环境内容时不注入，也不重置任务态。
2. **闸门状态选址与耐久** —— 状态原先存 `os.tmpdir()`，临时目录被清理后「每会话一次」的标记归零，同一会话反复注入对账；后改落 `${harness}/hooks/state/`，但 DSH 把 hook 子进程放进默认 workspace-write 沙箱（无 agent/session 的 shell 调用取部署默认），该沙箱对工作区根与系统临时目录以外只给 RX——`~/.dsh` 带 `CodexSandboxUsers:(OI)(CI)(RX)`，写入全数 EPERM，标记同样归零。现按 cwd 优先落工作区 `<cwd>/.dsh-hooks-state`，依次回退系统临时目录、`~/.dsh/hooks/state`，每个候选先做真实探针写；目录一经选定按会话固定，并写进状态文件与临时目录索引，使不带 cwd 的调用（UserPromptSubmit）也能找回同一份状态。附带 24h 过期清理，写失败写 stderr。
3. **记忆写入提醒** —— 记忆插件只有注入钩子、没有写入钩子，记不记全凭模型自觉（实测 31 轮会话零记忆操作）。Stop 侧兜一次底：本轮有实质落笔却没碰过记忆根时提醒一次，每会话至多一次，纯读轮不提醒。

## v5 (2026-10-11)

commit `1076083`。加入交叉确认与两个任务类型：

- **交叉确认** —— hook 注入关键词初判标签时，交付说明开头给【任务确认】块（任务数 + 每项类型与对象 + hook 判 vs 模型判对照）；不一致（计划态 / 描述 / 多任务）先质询再动手，用户裁决后写分歧台账（`~/.zcode/askq-divergence.jsonl`）供审计复算。
- **计划态** —— 自报计划措辞（我计划 / 我打算 / 我可能需要）的消息无论句中含什么动词都停在计划态：只读核查与方案讨论，禁编辑落笔与「删除范围选哪个」式执行确认反问，显式下令才执行。
- **描述** —— 大段无委托动词的背景或粘贴内容只回应不开工。

## v4 / v4B / v4C (2026-10-04)

- **v4**（`5690b25`）—— 路径守卫（按可回滚性判定）、诊断型任务、ambient 跳过、CJK 续接修正、modify 词表扩展、unknown 回退、scratch/script 区豁免、脚本内容扫描；首个 hook 测试套件（34 例，红先）。
- **v4B**（`3cecaad`）—— M1 完成断言证据门（Stop 侧 advisory，检测回合末段的无对冲完成断言）；复用 tail buffer 单次解析；SKILL.md 第 6 节同步到 v4/v4B。
- **v4C**（`5dcc390`）—— 确认点门禁，分步授权硬停点。

## v3 (2026-10-02)

commit `61e4cf5`。Bash 门禁三件套：变更类操作的存在性检查拦截、外发不可逆操作拦截、就地修改提醒。

## v2 (2026-09-28)

commit `b3c8dd4`。ask-first 协议 v2：开工三件套与漂移闸门取代在飞翻转计数器（背景见 [skills/ask-first/README.md](skills/ask-first/README.md)）。
