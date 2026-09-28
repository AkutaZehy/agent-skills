# ask-first

给编码 agent（ZCode / Claude Code 等 SKILL.md 类 harness）的反问协议 v2。核心主张一句话：**把"考虑要不要问"换成"考虑问什么"——开工就亮出任务类型、完成口径和反问批次，好过把思考变成没有出口的搜索。**

本项目由 GLM-5.3-Flash 构建。

## 为什么是 v2（两轮 rollout 实测）

1. **2026-09-23**：约 565 万字思维链扫描发现，"Better:/Simpler:" 型冒号提议出现后约 85% 被采纳（最该盯的换方案信号），而看着最危险的 "what if / how about" 约 78% 是自检疑问；一次实测里语义换手 3 次、模型自报 0 次。
2. **2026-09-28 复盘**：v1 的在飞翻转计数器（思维里维护 tally 行）装入后 5 天，反问 0 次、计数行只出现 3 次且是收尾汇报式回声——**模型对"正在进行的思考"做可靠的语义自计是不可执行的**，规则在场不等于触发。v2 因此把触发从模型内挪到任务结构上：开工三件套、读→改漂移闸门、可选的外置 hook 闸门（见下）。

思考语言因模型而异（GLM 中文思考多，MiMo/DeepSeek 全英文思考），所以 SKILL.md 内含 English 与 中文 两个等价版本。

## 安装

```bash
# 脚本方式（含 AGENTS.md 模板打印与可选闸门安装）
./install.sh --zcode --hooks     # 仓库根目录；--hooks 装 ZCode 结构闸门，可省略

# 手动方式
cp skills/ask-first/SKILL.md ~/.zcode/skills/ask-first/SKILL.md
cp skills/ask-first/SKILL.md ~/.claude/skills/ask-first/SKILL.md
```

行为规则需要每次会话在场：把 [templates/ask-first.md](../../templates/ask-first.md)（开工三件套整段）贴进用户级 AGENTS.md / CLAUDE.md。想要结构化提醒（开工、第一次落笔、收尾三个时刻注入，软规则之外多一道闸）就加 `--hooks`，仅 ZCode 支持。

## 协议摘要

开工三件套（编码/修改与环境/排障强制；检索、只读、纯对话豁免批次）：类型（读/改/读并改/检索+对象）、Done when 口径、一次 AskUserQuestion 反问批次（题目只锚定口径确认与真实分叉，grep 能答的先自查）。漂移闸门：声明为读的任务第一次落笔修改即视为"读并改"，补批次或声明无新分叉。不可验证分叉（谜底·偏好·用户脑内标准）出现即问；主导解释换手到第三次、或 "Better:" 型提议两次改写方案同样达反问线。超时：挂起加断点句，不代答。唯一例外："自己去找"。配套姿态：精益思考——先候选后短验证，第一次可行就沿用。

## License

MIT
