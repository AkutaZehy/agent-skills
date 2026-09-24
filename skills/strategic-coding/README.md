# strategic-coding

给编码 agent（ZCode / Claude Code 等 SKILL.md 类 harness）的战略编码纪律，源自 John Ousterhout《A Philosophy of Software Design》的战略式编程，按 AI 辅助的个人中型项目重新加权。核心主张一句话：**设计投资全部压在契约面（命名、公共接口、关键 why 注释），实现面允许糙；债按信号还、按迭代顺手还——设计没有阶段，只有心态。**

本项目由 GLM-5.3-Flash 构建。

## 为什么（AI 辅助开发里债务换了一种利息）

Ousterhout 的复杂度定义是依赖加晦涩，深模块 = 小接口大行为，战略式编程 = 每次触碰代码都投资设计。这套理论在 AI 辅助开发里反而更尖锐，因为四件事同时发生了：

1. **写码贬值，读码仍是瓶颈** —— agent 生成浅层重复代码的速度比清理快，软件熵增速率被 agent 加速（Matt Pocock 对同一问题的表述："agents radically speed up coding, they also accelerate software entropy"）。
2. **利息形式变了** —— 实现糙的代价不再是人读懂它的成本，而是每个会话重建上下文的 token：接口泄漏意味着 agent 每次干活都要重读一堆文件才能拼出理解。
3. **契约面的读者变了** —— agent 是最较真的读者，接口含糊立刻误用；注释是它能读到的 why 的最廉价载体，早写的注释直接进 prompt。
4. **重写比细读便宜** —— 所以实现面允许糙，投资只该花在会被依赖的接缝上。

## 规范摘要

**母原则**：名字、公共接口签名、关键 why 注释是契约面，做稳做净；其余是实现面，允许糙。

**四纪律**（场景无关）：

- **命名**：一个概念一个词，起名前先检索既有命名，项目术语表承载；名字长度与作用域成反比；起不出名 = 抽象有问题的信号，触发重构检查而非硬起；同概念双命名出现即合并（agent 会复制旧模式并忠实传播分裂）。
- **注释**：只写 why 不写 what（agent 默认生成复述型注释，见即删）；浅注释买精确（边界/单位/方案权衡），深注释买直觉（契约/设计取舍）；公共入口一行契约加为何存在；跨文件契约在提供方写一行（消费者看不到你的假设）；注释在定契约时写（最便宜的时刻）；改公共行为必过邻近注释和引用方 grep（agent 改码不改注释，腐烂是默认态）。
- **模块**：深度只花在会被依赖的接缝上，胶水和一次性工具保持浅是正确的；删除测试判浅模块去留；上下文测试（一个行为要开 3+ 个文件 = 接口泄漏，收敛它）；import 只走模块入口（深引用让入口变装饰）；依赖方向显式声明（表现层从计算层取类型与格式化函数，计算层不反向）；新行为先进已有模块，新文件要有理由（agent 默认爱建新文件）；两个 adapter 才是真 seam。
- **重构**：信号驱动（起不出名 / 注释说不出 why / 上下文测试失败 / 一处改动扇出多处），热区优先（git log 频率 = 深度回报最高的地方）；先测试后移动（深模块化时测试迁到新接口、旧浅模块单测删除——replace, don't layer）；diff 只移动代码，新行为是另一次变更；复制已有模块先声明意图（有意分叉还是该抽公共）；每次迭代往刚碰过的接缝还 ~10% 的债。

**两个应用**（同一纪律的两个时刻）：

- **起步（新项目或新顶层模块）**：术语表先行 → 公共入口先行（签名 + 一行 why 先于任何函数体）→ 骨架止于接缝 → 承重接缝 design it twice（两个真正不同的接口草图 + 一行取舍记录）。Done when：每个模块有声明过的入口、概念入术语表、AGENTS.md/README 有一行指针。
- **维护**：信号开门、热区选址；工序 = 覆盖率 → 移动 → 注释过 → 文档同步。Done when：开工程信号消失、测试绿、文档同步（文档同步是完成定义的一部分，不是后续）。

## 安装

```bash
# ZCode（用户级 skill）
cp skills/strategic-coding/SKILL.md ~/.zcode/skills/strategic-coding/SKILL.md

# Claude Code
cp skills/strategic-coding/SKILL.md ~/.claude/skills/strategic-coding/SKILL.md
```

或用仓库根的 `./install.sh --zcode`（strategic-coding 已在默认名单）。编码纪律属于行为类规则，更稳的用法是把 [templates/strategic-coding.md](../../templates/strategic-coding.md) 引用块贴进用户级 AGENTS.md / CLAUDE.md，保证每次写码时规范一定在场。

## 设计取舍

- **起步与维护合并成一个 skill**：Ousterhout 明说战略式编程是一种心态而非流程阶段，"初始化时设计、维护时还债"的二分是瀑布残留；增量式设计本来就是设计投资在每次增量中持续发生。真正值得分开的线在纪律本体与编排工具之间——需要全库扫描产候选时，外面挂编排器（如 mattpocock 的 improve-codebase-architecture），而不是把本体拆开。
- **内嵌最小词汇，不强依赖外部 skill**：deletion test、上下文测试、design it twice 都在正文里自足可用；test-hygiene / domain-modeling / codebase-design 写成"装了就引用"，装没装都能跑。
- **正文用英文**：对齐 memory-hygiene 的先例——编码规则以英文进模型最稳；触发词进 description 兜中文语义匹配。

## Credits

- John Ousterhout, *A Philosophy of Software Design*（2nd ed.）— 战略式编程、深模块、复杂度=依赖+晦涩、design it twice、增量式设计。
- [mattpocock/skills](https://github.com/mattpocock/skills) — deletion test、seam/adapter 词汇与 DESIGN-IT-TWICE 并行子代理模式取自其 codebase-design skill；热区扫描思路取自其 improve-codebase-architecture。

## License

MIT © 2026 AkutaZehy
