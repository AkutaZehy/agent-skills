# agent-skills

给编码 agent（ZCode / Claude Code 等 SKILL.md 类 harness）的技能合集。每个 skill 一个目录，`skills/<name>/SKILL.md` 统一结构；本 README 是索引和安装总入口。

本项目由 GLM-5.3-Flash 构建。由原独立仓库 memory-hygiene / ask-first / zcode-wallet 合并而来。

## Skills 一览

| Skill | 一句话 | 详细说明 |
|---|---|---|
| [memory-hygiene](skills/memory-hygiene/) | 给 agent 的记忆文件卫生规范：记终态别记流水账，说做什么别说别做什么 | [README](skills/memory-hygiene/README.md) |
| [ask-first](skills/ask-first/) | 反问协议：不确定先问、翻转计数器、超时挂起断点（English/中文双语） | [README](skills/ask-first/README.md) |
| [zcode-wallet](skills/zcode-wallet/) | ZCode token/额度账本只读分析："我的额度都烧哪儿了" | [README](zcode-wallet/README.md) |

## 安装

```bash
git clone https://github.com/AkutaZehy/agent-skills.git
cd agent-skills

# ZCode：按需拷贝
cp -r skills/memory-hygiene ~/.zcode/skills/
cp -r skills/ask-first ~/.zcode/skills/
cp -r skills/zcode-wallet ~/.zcode/skills/

# Claude Code 同理，目标换 ~/.claude/skills/
```

zcode-wallet 的 SKILL.md 依赖同名 CLI（单文件纯标准库），先看 [zcode-wallet/README.md](zcode-wallet/README.md) 装好 `zwallet` 再装技能。

## 与用户级指令配合

skill 靠语义匹配触发，有漏触发的可能；更稳的用法是在 AGENTS.md / CLAUDE.md 里直接引用规则正文，保证每次会话在场——各 skill 的 README 内附引用模板。

## License

MIT
