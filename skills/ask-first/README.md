# ask-first

给编码 agent（ZCode / Claude Code 等 SKILL.md 类 harness）的反问协议。核心主张一句话：**不确定且无法自行收敛时，抛出一个阻塞式提问等人，好过把思考变成没有出口的搜索。**

本项目由 GLM-5.3-Flash 构建。

## 为什么需要它（2026-09-23 rollout 实测）

对约 565 万字 agent 思维链的扫描与 120 条人工抽样校验发现三件事：

1. **换手漏计是常态** — 一次实测里语义换手 3 次、模型自报 0 次；wait 词表只覆盖约 1/3 真实翻转信号（hmm 才是最高频的自打断词），且模型会把翻转包装成"只是排名微调"。
2. **危险词和直觉相反** — "Better:/Simpler:" 型冒号提议出现后约 85% 被采纳，是最该盯的换方案信号；而看着最危险的 "what if / how about" 约 78% 是自检疑问，问完自己就否了。
3. **个人协作开发没有工厂级 uptime 要求** — 反问超时时挂起等人、输出断点，好过自作主张取一个假设继续跑。

思考语言因模型而异（GLM 中文思考多，MiMo/DeepSeek 全英文思考），所以 SKILL.md 内含 English 与 中文 两个等价版本，跟随思考语言在场。

## 安装

```bash
# ZCode
cp skills/ask-first/SKILL.md ~/.zcode/skills/ask-first/SKILL.md

# Claude Code
cp skills/ask-first/SKILL.md ~/.claude/skills/ask-first/SKILL.md
```

与 memory-hygiene 相同，更稳的用法是在用户级指令文件（AGENTS.md / CLAUDE.md）里直接引用规则，保证每次在场：

```markdown
- 同一问题方案推翻到第三次（词表提示：wait/hmm/but wait/hold on…，中文思考为 等等/不对/其实）→ 停止重试，AskUserQuestion 一次问全并等待；
- 思考内维护 tally 行（翻转:N 冒号:N），新用户消息/答案发出/切子任务时归零；
- 反问超时 → 终止思考、不自行取信，输出"我提出了问题 X，等待用户回复"。
```

## 协议摘要

触发（任一命中即问）：同一问题第三次翻案 / "Better:" 型冒号提议换手两次 / 不可验证分叉（谜底·偏好·用户脑内标准）。计数：主导解释换手计 1，词表只是提示；tally 行当场 +1，三归零。超时：挂起加断点句，不代答。唯一例外："自己去找"。配套姿态：精益思考——先候选后短验证，第一次可行就沿用。

## License

MIT
