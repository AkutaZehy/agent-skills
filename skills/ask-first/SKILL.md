---
name: ask-first
description: Ask the user instead of storm-searching when uncertain — flip counter with a visible tally, batched AskUserQuestion, suspend-with-breakpoint on timeout. Use when a term, file location, or A/B plan choice is ambiguous, when approaches keep flipping, or when a fork cannot be converged with evidence. 触发词：反问、先问、不确定就问、超时挂起。
---

# Ask First

A deliberation that keeps flipping is search with no exit. The cheap exit is a question. This skill turns "third flip / unverifiable fork" into one blocking AskUserQuestion, and turns a timed-out question into a suspended breakpoint — never into a guess. Rules are given in English and in 中文; apply the version matching your current thinking language.

## 1. When to stop and ask

- **Third flip.** On one question, once the dominant explanation has changed hands twice (two full teardowns), stop retrying and ask. The counting unit is a change of the dominant explanation — the marker words below are hints, not the counter. Euphemized flips ("just a minor re-ranking") still count.
- **Colon proposals.** "Better: / Cleaner: / Simpler: / Safer:" is a high-risk switch signal (adopted ~85% of the time in practice). After proposing, either justify immediately or keep the current plan; two such switches on one question reach the ask line. "What if / how about" are self-check questions — handle them as verification, not counted as switches.
- **Unverifiable forks.** Puzzle answers, the user's mental standard, pure preference — no evidence channel converges these. Ask immediately; convert a guess list into AskUserQuestion options.

Batch every open fork into ONE AskUserQuestion call (what X means / where X lives / plan A or B), then wait for the answer.

## 2. Counter discipline

- Keep a visible tally line in thinking: `flips:N colon:N` (翻转:N 冒号:N); increment in place at every flip.
- Reset to zero on: new user message, answer sent, explicit switch to a subtask.
- When your self-report disagrees with the semantic flips, the semantics win — models undercount their own flips.

## 3. Marker hints

- English thinking: wait, hmm, but wait, no wait, actually wait, hold on, let me reconsider, But honestly, Hmm but, Let me re-read / reconsider / think.
- Chinese thinking (GLM family): 等等、不对、其实.

## 4. Timeout = suspend, not improvise

If the question returns unanswered (user away, harness timeout), terminate the deliberation on that question and pick no substitute assumption. Output a breakpoint: "I asked: X — waiting for your reply", noting which fork the thinking stopped at. Personal AI collaboration carries no factory-grade requirement to keep running; suspending beats guessing.

## 5. Exception

"Go find it yourself" (自己去找) is the only opt-out: switch to self-serve research and stop asking.

## 6. Lean thinking (where flips come from)

Candidate answer first, then brief verification (a few lines); keep the first workable approach; simple tasks run no verification loop. The urge to verify everything is RL-trained and cannot be deleted — treat it as a dial, not an on/off switch.

---

# 中文版（Ask First）

会一直翻案的思考就是没有出口的搜索，而最便宜的出口是提问。本 skill 把"第三次翻案 / 不可验证分叉"变成一次阻塞式 AskUserQuestion，把超时问题变成挂起断点——绝不变成瞎猜。以下规则与英文版等价，跟随当前思考语言选用。

## 1. 何时停笔发问

- **第三次翻案。** 同一问题内主导解释已换手两次（整体推翻过两次）时，停止重试、发起提问。计数单位=主导解释换手，下文词表只是提示，不是计数本体；包装成"只是排名微调"的换手照计。
- **冒号提议。** "Better:/Cleaner:/Simpler:/Safer:" 是高危换方案信号（实测约 85% 被采纳）：提议后要么当场论证、要么沿用现方案；同一问题内该型换手两次即达反问线。"what if / how about" 属自检疑问，按验证处理，不计换手。
- **不可验证分叉。** 谜底、用户脑内标准、纯偏好——没有证据通道可以收敛，出现即问；把猜测清单转成 AskUserQuestion 的选项列表。

所有未决分叉合并进一次 AskUserQuestion（术语 X 什么含义 / X 在哪 / 选 A 还是 B），抛出后等待回答再继续。

## 2. 计数器纪律

- 思考里维护一行可见计数：`翻转:N 冒号:N`（flips:N colon:N），每次换手当场 +1。
- 三归零：新用户消息、答案发出、显式切入子任务。
- 自报数与语义换手不一致时以语义为准——模型会漏计自己的翻转。

## 3. 标志词提示

- 英文思考：wait、hmm、but wait、no wait、actually wait、hold on、let me reconsider、But honestly、Hmm but、Let me re-read/reconsider/think。
- 中文思考（GLM 系）：等等、不对、其实。

## 4. 超时=挂起，不代答

问题超时未获回答（用户离开 / harness 超时）时，终止该问题的后续思考，不自行取信代答；输出断点："我提出了问题 X，等待用户回复"，并注明思考断在哪个分叉。个人 AI 协作开发没有工厂级的持续运作要求，挂起优先于猜着继续。

## 5. 唯一例外

用户明确说"自己去找"时切换为自行查证，停止发问。

## 6. 精益思考（翻案从哪来）

先给候选结论再短验证（几行内）；方案第一次可行就沿用；简单任务不跑验证循环。验证冲动是 RL 训练烙进去的，删不掉——当旋钮用，不当开关用。
