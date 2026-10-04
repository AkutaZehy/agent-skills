---
name: test-hygiene
description: Use when writing, editing, or reviewing tests, evaluating AI-generated test quality, or setting up test suites. Also covers tautological/weak assertion cleanup and mutation testing. 触发词：写测试、改测试、测试审查、测试质量、同义反复断言、突变检验。
---

# 测试卫生

核心原则：测试是规格的第一个客户；一条测试的验收标准是它能杀死哪个变异体，而非看起来对。

## 循环纪律

- 红先于绿：每条测试先运行一次并出示失败输出（失败原因符合预期），再写实现，再出示通过输出。没红过的测试视为不存在。
- 一次只解一个红；中途发现的新行为记入测试清单，另行开测。
- 每步出示命令与真实输出，用运行证据替代叙述。

## 断言来源

- 期望值只来自规格、领域样例或用户给的例子，与实现输出隔离；先跑实现再抄输出的做法产出的是确认器而非证伪器。
- 特征化测试与金样本显式标注（名称或注释注明 characterization 及生成版本）。
- 每条测试至少含一个具体值断言；弱断言单独出现即删：仅断言非空、仅断言不抛异常、纯 mock 调用顺序、assert True 类恒真断言。

## 审测试：突变判据

- 逐条回答：翻转条件、改常数、删分支、改边界——哪一个变异体能杀死这条测试？说不出的测试删除。
- 高价值测试手动突变抽检：故意改错一行实现，测试必须红。
- 批量用工具：Python=mutmut，JS/TS=Stryker，Java=PIT，C#=stryker-net。
- 性质测试补穷举例之短：往返一致、幂等、不变量、与朴素参照实现等价，配 Hypothesis（Python）/ fast-check（JS）生成例。写性质可靠，枚举例不可靠——让框架生成。

## 上下文隔离

- 实现与测试分开两次调用或两个 agent：一个只读规格写测试，一个只看测试写实现；同一上下文连写会镜像同一个盲点。
- 审查代理按突变判据逐条裁决保留与删除，裁决附变异体名称。
