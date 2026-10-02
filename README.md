# agent-skills

给编码 agent（ZCode / Claude Code 等 SKILL.md 类 harness）的技能合集。每个 skill 一个目录，`skills/<name>/SKILL.md` 统一结构；本 README 是索引和安装总入口。仓库分四层：`skills/`（技能）、`templates/`（AGENTS.md 引用块）、`hooks/`（可选的结构闸门脚本）、`tools/`（配套工具代码）。

本项目由 GLM-5.3-Flash 构建。由原独立仓库 memory-hygiene / ask-first / zcode-wallet 合并而来。

## Skills 一览

| Skill | 一句话 | 详细说明 |
|---|---|---|
| [memory-hygiene](skills/memory-hygiene/) | 给 agent 的记忆文件卫生规范：记终态别记流水账，说做什么别说别做什么 | [README](skills/memory-hygiene/README.md) |
| [ask-first](skills/ask-first/) | 反问协议 v2：开工三件套（类型/Done when/反问批次）、读→改漂移闸门、超时挂起断点（English/中文双语） | [README](skills/ask-first/README.md) |
| [zcode-wallet](skills/zcode-wallet/) | ZCode token/额度账本只读分析："我的额度都烧哪儿了" | [README](tools/zcode-wallet/README.md) |
| [strategic-coding](skills/strategic-coding/) | 战略编码纪律：契约面做净（命名/接口/why 注释），实现面允许糙，信号驱动还债 | [README](skills/strategic-coding/README.md) |
| [publish-privacy-alert](skills/publish-privacy-alert/) | 对外发布前的隐私卫生审查：机器画像驱动扫描 + 四类核对 + 交付物终扫（数据与逻辑分离，画像仅存本机） | [SKILL](skills/publish-privacy-alert/SKILL.md) |
| [negafix](skills/negafix/) | 负向平行结构禁令与审计（"it's not just X, it's Y"），上游 v1.2.1 + 本地中文检测段 | [SKILL](skills/negafix/SKILL.md) |

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

**hooks（可选，仅 ZCode）**：`--hooks` 把 `hooks/askfirst-gate.js` 装到 `~/.zcode/hooks/` 并合并进 `~/.zcode/cli/config.json` 的 hooks 配置。两类作用：①开工、第一次落笔、收尾三个时刻注入提醒（开工三件套 / 读→改漂移 / 翻转超限对账）；②Bash 变更/外发门禁（v3）——外发不可逆（git push、npm publish/unpublish、gh repo|release 删发、gh api 写操作）首拦；覆盖/删除类 hook 自查目标存在性，有东西可丢才拦；git 状态覆盖类首拦；就地修改类提醒。被拦后重跑同一命令即放行。这是安装器唯一会改你文件的步骤：自动备份 config.json、幂等可重跑、回滚=把打印出的备份文件复制回去。不带 `--hooks` 时一切照旧，只拷贝和打印。

zcode-wallet 的 SKILL.md 依赖同名 CLI（单文件纯标准库，源码在 [tools/zcode-wallet/](tools/zcode-wallet/)），先看 [tools/zcode-wallet/README.md](tools/zcode-wallet/README.md) 装好 `zwallet` 再装技能。仓库版 SKILL.md 是路径无关的；若你的本地副本有意写死了 CLI 绝对路径，安装时用 `SKILLS` 跳过它，别让脚本覆盖。

## 加载模型（懒加载机制）

skill 不是装上就常驻生效的，加载分四层：

1. **description 常驻** — 每会话系统提示里只有一行 name + description，这是唯一的自动触发面，靠语义匹配；
2. **正文懒加载** — SKILL.md 正文仅在模型判定相关（或 `/skill-name` 手动调用）时才进入上下文；
3. **AGENTS.md 引用兜底** — 行为类规则需要每次会话无条件在场，把 [templates/](templates/) 里的引用块贴进用户级 AGENTS.md / CLAUDE.md 即可，整段随会话进缓存后近乎零成本；
4. **工具型 skill 保持懒加载** — 查询/流程类（如 zcode-wallet）天然事件驱动，description 触发词就是启动条件，无需常驻。

一句话：**行为规则进 AGENTS.md，操作手册留 skill 懒加载**。这套机制在 ZCode / dsh / Claude Code 等同源 harness 上行为一致：SKILL.md 格式同款，仅安装目录不同；AGENTS.md 引用块三家通用；memory 属于各 harness 本机私有态，不在本仓库范围内。

## License

MIT
