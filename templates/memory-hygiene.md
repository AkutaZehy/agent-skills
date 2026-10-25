<!-- memory-hygiene 的 AGENTS.md 引用块：整段贴到用户级 AGENTS.md / CLAUDE.md 的记忆纪律节。 -->

## 记忆纪律（文件记忆）

- 记忆写法遵循 memory-hygiene skill：正向表述优先（说做什么，负面约束配正向替代同句出现）、记终态不记流水账（单文件超 ~8KB 时重写为终态+归档全史到 memory-archive/）、错误示范只留最小痕迹（规则+一行证据+检查方法，用户原话除外）、索引行 ≤120 字符。更新记忆时同一轮同步索引行。
- 功能文卫生（README/计划/报告/to-doc 产物等 AI 起草的说明文；博客/日记等人味文除外）：祈使负向约束（"不要xxx"）同句配正向替代，迁移/过程叙事写终态；askfirst-gate 的功能文 advisory 在落笔时提醒，判据见 memory-hygiene skill「Scope boundary」。
