# 组件变更史(按组件归组)

时间线完整记录见 [CHANGELOG.md](../CHANGELOG.md);本文件按组件归组,方便查"某个 skill/hooks 经历了什么"。

## skills

- **ask-first**:反问协议演进 v2(2026-09-28)→ v3(10-02)→ v4/v4B/v4C(10-04)→ v5(10-11)→ v6(10-15)→ v7(10-25);配套 ZCode 变体闸门 askfirst-gate.js 同步演进,测试台 test-gate.js 76 例。
- **memory-hygiene**:2026-09-28 随 v2 并入;2026-10-27 记忆分层、生成索引与同步 SOP;版本 1.0.0。
- **strategic-coding**:随仓库初版收录(原独立仓库合并而来)。
- **shell-hygiene**:2026-10-26 本机实测成文;2026-11-28 PowerShell 项去版本号化、单行处方改 pwsh7 优先,启动开销实测入档(bash ~80ms / pwsh ~380ms / 5.1 ~270ms)。
- **negafix**:上游 v1.2.1(MIT)+ 本地中文检测段;2026-11-23 升 1.2.1+local.2(中文破折号密度与抽象名词化检测)。详见 [skills/negafix/CHANGELOG.md](../skills/negafix/CHANGELOG.md)。
- **research-intake / publish-privacy-alert / test-hygiene / deliverable-medium**:随仓库收录;publish-privacy-alert 1.0.0(scan.sh 与 symlink 行为断言在册),其余细节见各自 SKILL.md / README。
- **ctx-batch**:2026-11-25 新增,scan/read/run/page 四子命令;脚本 `skills/ctx-batch/scripts/ctx.py`。
- **zcode-wallet**:2026-10-11 退役至 [deprecated/](../deprecated/)。

## hooks

- **askfirst-gate.js(ZCode 变体)**:随 ask-first 协议 v2→v7 演进;测试台 test-gate.js 76 例。
- **askfirst-gate.dsh.js(DSH 变体)**:v7 时代实现;2026-11-28 退役至 [deprecated/](../deprecated/)。配套 test-gate.dsh.js(84 例)与 test-sync.js(56 项契约守卫)保留在树内,守卫指向退役副本防误改。
- **browser-route.js**:2026-10-30 新增(尾部注入采纳率高于首位的实测支撑)。
- **bash-lint.js**:2026-11-25 新增(五项预检 R1-R5);测试用例待补。

## templates

- **output-style.md**:输出风格三行的正本,跨 harness 通用。
- **agents-md-full.md**:2026-11-28 入库,作者用户级 AGENTS.md 完整实例(结构正本)。逐节脱敏:provider 型号名、机器实时状态、个人模型配置三处移除并留 `[机器私有]` 槽位;本机私有文件引用改自备/指针表述;绝对盘符改占位符。

## docs

- **install.md**:2026-11-28 自 README 安装节拆出(安装、hooks 注册、版本口径、退役记录、Claude Code 适配占位)。
- **history.md**:2026-11-28 建立,按组件归组;时间线完整记录见 CHANGELOG。
