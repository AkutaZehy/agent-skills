# 安装、hooks 注册与版本口径

本文件承接原 README 的安装节。作者本人是 ZCode 用户，安装路径与实测值以 ZCode 环境为主；其他 SKILL.md 类 harness 按同构目录替换即可。

## 安装

脚本方式（拷贝到对应 harness 的技能目录，并打印 AGENTS.md 模板块；只拷贝和打印，不改你的任何文件）：

```bash
git clone https://github.com/AkutaZehy/agent-skills.git
cd agent-skills
./install.sh --zcode                     # 装到 ~/.zcode/skills/
./install.sh --claude                    # 装到 ~/.claude/skills/
SKILLS="ask-first" ./install.sh --zcode  # 只装一个
./install.sh --zcode --hooks             # 额外安装 ask-first 闸门（见下）
```

手动方式等价于对每个 harness 的技能目录 `cp -r skills/<name>`（ZCode=`~/.zcode/skills`、Claude Code=`~/.claude/skills`）。

默认 `SKILLS` 列表：memory-hygiene、ask-first、strategic-coding、shell-hygiene。其余 skill（research-intake、publish-privacy-alert、test-hygiene、negafix、deliverable-medium、ctx-batch）按需单装：`SKILLS="<name>" ./install.sh --zcode`。ctx-batch 的脚本随目录一起拷入（`skills/ctx-batch/scripts/ctx.py`）；想按 `~/.zcode/bin/ctx.py` 的写法调用，自行建软链或拷贝到该路径。

negafix 是第三方 skill（上游 Ihor Orlovskyi v1.2.1，MIT）加本地中文检测段的补丁版；上游出新版覆盖安装副本会丢中文段，以本仓库 `skills/negafix/` 为正本重拷。

**templates**：安装结束会打印所选 skill 的 AGENTS.md 引用块；另有 [templates/output-style.md](../templates/output-style.md)——输出风格三行的正本，跨 harness 通用，贴进各 harness 的输出风格节或等价位置；[templates/agents-md-full.md](../templates/agents-md-full.md)——作者的用户级 AGENTS.md 完整实例（结构正本），按需裁剪，`[机器私有]` 标注行是部署侧增补示例、不同步回模板。

## Hooks

**askfirst-gate（可选，ZCode 变体）**：ask-first 的结构闸门，装到 `~/.zcode/hooks/`，`--hooks` 自动合并进 `~/.zcode/cli/config.json`。作用：①开工/首次落笔/收尾三时刻注入（开工三件套含【任务确认】块：任务数+hook判vs模型判对照，不一致先质询 / 计划态与描述分类 / 读→改漂移 / 翻转对账 / M1 完成断言证据门；v7 起补 unknown/读/检索/描述轮轻提醒、最小完备集文案、功能文卫生 advisory）；②shell 变更/外发门禁——外发不可逆（git push、npm publish/unpublish、gh repo|release 删发、gh api 写）首拦；路径守卫按可回滚性判定（git tracked 放行、脚本区/临时/记忆放行、非 git 或未追踪的既有文件拦一次核对拼写）；git 状态覆盖首拦；确认点门禁（用户指令含硬停点或 AI 问题文本自书确认承诺时，用户区写硬拦且不因重跑放行）；就地修改提醒。被拦后**逐字重跑同一命令**即放行。状态落 `~/.zcode/hooks/state`（24h 过期清理）。记忆写入在 Stop 侧兜底提醒一次。`hooks/test-gate.js`（76 例）。

**DSH 变体（已退役）**：`hooks/askfirst-gate.dsh.js` 已退役至 [deprecated/askfirst-gate.dsh.js](../deprecated/askfirst-gate.dsh.js)——DSH 环境停止维护：装到 `~/.dsh/hooks/`、手工注册进 dsh `hooks.json`、状态按 cwd 落 `<cwd>/.dsh-hooks-state` 的用法随迁。配套用例 `hooks/test-gate.dsh.js`（84 例）与契约守卫 `hooks/test-sync.js`（56 项）保留在树内：守卫指向 deprecated 侧副本，防退役副本被误改后与 ZCode 版漂移。

**browser-route（可选，ZCode 单变体）**：`hooks/browser-route.js`（装到 `~/.zcode/hooks/`，注册进 `~/.zcode/cli/config.json` 的 `UserPromptSubmit`）。任务涉及浏览器操作时在消息尾部注入路线规则——默认走 browser-use（`mcp__node_repl__js` + ZCode 内嵌浏览器 IAB），playwright MCP 留给它的专属场景（console 报错捕获 / network 请求体检查 / route mock / cookie 与 storage 读写 / 文件上传 / PDF 导出 / emulate_media / run_code_unsafe），判据是"这次要不要 console / network / mock / cookie / 上传 / PDF"。落点在尾部是因为实测尾部注入的采纳率高于首位注入（AGENTS.md 注入在 messages 首个 user 消息，离当前轮可达 250K tokens）。用户点名 playwright 时不注入，按用户指定执行；非浏览器任务不注入；同会话至多注入一次。`hooks/test-browser-route.js`（21 例）。

**bash-lint（可选，ZCode 单变体）**：`hooks/bash-lint.js`（装到 `~/.zcode/hooks/`，注册进 `~/.zcode/cli/config.json` 的 `PreToolUse` 与 `PostToolUse`，两次都传事件名：`node bash-lint.js PreToolUse`）。PreToolUse 做五项检查并在有明确证据时才拦：R1 语法（`bash -n`，以及 `python - <<EOF` heredoc 的 `py_compile`）、R2 破坏性命令（`find -delete` / `xargs rm` / `Remove-Item -Recurse` / `git clean -fd` / `git reset --hard`；首次拦、逐字重跑放行）、R3 失败重试（同一命令 10 分钟内失败过则拦，要求改一个变量）、R4 目标存在（`mkdir` 父目录、`cp`/`mv`/`install` 的源与目标父目录、重定向目标不是目录且父目录存在）、R5 工具可用（`command -v` 结果缓存 1 小时）；PostToolUse 记录失败命令的 hash 供 R3 使用（`exit_code` 缺失时以 interrupted 或 stderr 强标记判定，grep/rg/`test`/`git diff --exit-code` 等预期非零走白名单）。内部异常一律放行，不阻塞会话。Windows 上自动探测 `C:/Program Files/Git/bin/bash.exe` 与 `C:/Program Files/Python312/python.exe`，探测不到退回 PATH 上的 `bash` / `python`。与 ask-first 的闸门分工：路径碰撞类（rm/cp/mv/git 状态覆盖）由 askfirst-gate 负责，本 hook 不重复拦。**尚无配套 `hooks/test-*.js`**，用例待补。

## 版本口径

**协议与批次**：ask-first 协议当前为 v7；hook 的 v4/v4B/v4C 等是 gate 特性批次，不是协议版本。

**Skill 版本**（`x.y.z`：措辞澄清/示例 = patch；触发条件/输出格式/权限变化 = minor；删除能力或改变默认行为 = major；`hooks/test-docs.js` 断言本表与各 SKILL frontmatter 的 `version` 一致）：

| Skill | 版本 |
|---|---|
| memory-hygiene | 1.0.0 |
| publish-privacy-alert | 1.0.0 |

**变更史**：按组件梳理的变更索引见 [docs/history.md](history.md)；按时间线的完整记录见 [CHANGELOG.md](../CHANGELOG.md)。

**Claude Code 适配**：`./install.sh --claude` 装 skill 文本层（软规则）；hook 变体未做 CC 适配。

<!-- [待补] Claude Code 适配长段：作者自写,此处占位；旧版以 askfirst-gate.dsh.js 为基底的指引已随 DSH 变体退役,新版建议指向 deprecated/askfirst-gate.dsh.js 与 hooks/test-gate.dsh.js 用例形态自证。 -->

zcode-wallet（技能+CLI）已于 2026-10-11 退役，见 [deprecated/](../deprecated/)——其 SKILL.md 已改名 `SKILL.md.retired`，不会被 skills.sh 等收录；需要时从 git 历史或 deprecated/ 目录复活。
