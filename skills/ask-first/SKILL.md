---
name: ask-first
description: Ask at task start and at unverifiable forks instead of guessing - opening trio (task type, done-when, one batched AskUserQuestion), read-to-write drift gate, mutation/external Bash gates, suspend-with-breakpoint on timeout. Use when starting a coding or debugging task, when a term, file location, or A/B fork is ambiguous, or when approaches keep flipping. 触发词：反问、先问、开工三件套、不确定就问、超时挂起、变更门禁、外发门禁。
---

# Ask First

Asking is the cheapest exit from an ambiguous task. This skill turns a task start into a three-item opening gate (type / done-when / one batched question), turns a read task that starts writing into a re-gated task, and turns a timed-out question into a suspended breakpoint — never into a guess. Rules are given in English and in 中文; apply the version matching your current output language.

## 1. The opening trio (every substantive task message)

1. **Type** — read / modify / read+modify / research, with the object named.
2. **Done when** — the acceptance criterion: what phenomenon appears, which test goes green, which bug no longer reproduces.
3. **Question batch** — one AskUserQuestion (≤4 items). Questions come from two sources only: confirming the done-when reading, and real forks (plan A/B, scope, terminology). Anything a grep can answer, resolve by grep first.

The trio is forced for coding/modification and environment/debugging tasks; for research, read-only, and pure conversation, declare type and done-when and skip the batch. It goes at the top of the deliverable so the user can correct it on sight.

## 2. The drift gate

A task declared as read or research (including "think of options", "suggest improvements") becomes read+modify at the first Edit/Write. Before that first write, correct the type and send the question batch — or state plainly "no new forks" and proceed.

## 3. Ask at unverifiable forks

Puzzle answers, the user's mental standard, pure preference — no evidence channel converges these; ask immediately and turn a guess list into question options. The same applies when the dominant explanation of one question has changed hands a third time, or when Better:/Cleaner:/Simpler:/Safer: proposals have switched the plan twice. Marker words (wait, hmm, but wait, hold on, let me reconsider; 等等、不对、其实) are hints for after-the-fact review, not a runtime counter — no in-flight tallying. "Go find it yourself" (自己去找) is the only opt-out.

## 4. Timeout = suspend, not improvise

If the question returns unanswered (user away, harness timeout), terminate the deliberation on that question and pick no substitute assumption. Output a breakpoint: "I asked: X — waiting for your reply", noting which fork the thinking stopped at. Personal AI collaboration carries no factory-grade requirement to keep running; suspending beats guessing.

## 5. Lean thinking

Candidate answer first, then brief verification (a few lines); keep the first workable approach; simple tasks run no verification loop. The urge to verify everything is RL-trained and cannot be deleted — treat it as a dial, not an on/off switch.

## 6. Mutation and external gates (hook-enforced)

The `hooks/askfirst-gate.js` gates (v4/v4B) enforce edit-operation discipline mechanically (see the edit-operation rule: look at the target before write/modify/delete/move). Behavior on a deny: inspect the target (ls/cat/git status) or get user confirmation, then re-run the same command — an exact re-run passes; that re-run is the "I looked" signal.

| Class | Operations | Gate |
|---|---|---|
| External / irreversible | `git push`, `npm publish/unpublish`, `gh repo delete`, `gh release create/delete/upload`, `gh api -X DELETE/POST/PUT/PATCH` | block first; passes after user confirmation (AskUserQuestion or explicit instruction) and re-run |
| Git state overwrite | `git reset --hard`, `git checkout -- <path>`, `git restore`, `git stash drop/pop/clear`, `git clean`, `git branch -D`, `git tag -d` | block first (existence cannot be checked cheaply); re-run passes |
| Path guard (v4) | Edit/Write plus mutating Bash (`rm`, `cp`/`mv`, `> ` redirect, `tee`, `curl -o`, `tar -x`, …) on user-zone targets | rollback-aware, per target: scratch/script zones (`~/.zcode` root, tmp, workspace, OS temp) and the memory dir pass silently; git-tracked files pass (recoverable); AI-created files this session pass; pre-existing untracked files in git and pre-existing files in non-git dirs → block once to verify the path isn't mistyped, re-run passes |
| Script content scan (v4) | executing a scratch-zone script (`node`/`python`/`npx` …) whose content contains destructive calls (`rm`, `rmSync`, `sed -i`, `git push`, …) | block once to check the script's internal targets; re-run passes |
| In-place modify | `sed -i`, `perl -pi`, `git commit --amend`, `git rebase`, `git filter-branch`, `git stash pop`, `patch`/`git apply` | remind once per kind per session: verify the pattern hits only what is intended, diff after |

Task typing (v4): ambient/system messages and short continuations never reset the task state; inspection keywords without a modify verb classify as 诊断 (diagnostic — zero-modification by default, first modifying write gets an advisory); unmatched prompts are `unknown` (neutral accounting prompt on first modifying write); drift/对账/诊断 fire only on modifying writes — tool, memory and config writes are healthy exploration and stay silent. Completion-assertion evidence gate (v4B, M1): if the turn's final text contains an unhedged completion claim (修好了/绿了/is fixed …) and the turn ran no verification command, an advisory asks to attach an evidence chain or rewrite as "expected complete, pending verification" — once per session.

Parse failures (variables, exotic quoting, unconvertible paths, missing git) fail open — the gate never blocks on uncertainty, only on a positively detected loss.

Hook availability: the gate exists as two harness variants — `hooks/askfirst-gate.js` (ZCode) and `hooks/askfirst-gate.dsh.js` (DSH), kept in sync by `hooks/test-sync.js`. On Claude Code this skill installs as the soft-rules layer (sections 1–5) only; see the repo README for adapting the dsh variant to CC.

---

# 中文版（Ask First）

提问是含糊任务最便宜的出口。本 skill 把任务开工变成三件套（类型 / done-when / 一次合并提问），把"读着读着开始改"变成重新过闸的任务，把超时问题变成挂起断点——绝不变成瞎猜。规则中英等价，按当前输出语言选用。

## 1. 开工三件套（每条实质性任务消息）

1. **类型**——读 / 改 / 读并改 / 检索，写明对象。
2. **Done when**——完成口径：什么现象出现、哪条测试绿、bug 不再复现。
3. **反问批次**——一次 AskUserQuestion（≤4 题）。题目只来自两个源头：确认 done-when 的口径，与真实分叉（方案 A/B、范围、术语）；grep 能答的先自查。

编码/修改与环境/排障类强制三件套；检索、只读、纯对话类声明类型与 done-when、省略批次。三件套写进交付说明开头，用户可当场纠正。

## 2. 漂移闸门

开工声明为读或检索的任务（含"想方案、提改进建议"类），在第一次 Edit/Write 时即变为"读并改"：落笔前更正类型并发反问批次，或明确声明"无新分叉"后继续。

## 3. 不可验证分叉即问

谜底、用户脑内标准、纯偏好——没有证据通道可以收敛，出现即问，把猜测清单转成选项列表。同一问题的主导解释换手到第三次、或 Better:/Cleaner:/Simpler:/Safer: 型提议两次改写方案时，同样发问。标志词（wait、hmm、but wait、hold on、let me reconsider；等等、不对、其实）只是事后复查的提示，不是在飞计数器——不要求边想边数。"自己去找"是唯一豁免。

## 4. 超时=挂起，不代答

问题超时未获回答（用户离开 / harness 超时）时，终止该问题的后续思考，不自行取信代答；输出断点："我提出了问题 X，等待用户回复"，并注明思考断在哪个分叉。个人协作开发没有工厂级的持续运作要求，挂起优先于猜着继续。

## 5. 精益思考

先给候选结论再短验证（几行内）；方案第一次可行就沿用；简单任务不跑验证循环。验证冲动是 RL 训练烙进去的，删不掉——当旋钮用，不当开关用。

## 6. 变更与外发门禁（hook 强制，v4/v4B）

`hooks/askfirst-gate.js` 的门禁（v4/v4B）把编辑操作纪律机械化（写/改/删/挪先看目标）。被拦时的动作：先看目标（ls/cat/git status）或先经用户确认，然后**重跑同一命令即放行**——重跑就是"看过一眼"的信号（要求逐字相同）。

| 类别 | 操作 | 门禁 |
|---|---|---|
| 外发不可逆 | `git push`、`npm publish/unpublish`、`gh repo delete`、`gh release create/delete/upload`、`gh api -X DELETE/POST/PUT/PATCH` | 首拦；经用户确认（AskUserQuestion 或明示）后重跑放行 |
| git 状态覆盖 | `git reset --hard`、`git checkout -- <路径>`、`git restore`、`git stash drop/pop/clear`、`git clean`、`git branch -D`、`git tag -d` | 首拦（存在性没法便宜检查）；重跑放行 |
| 路径守卫（v4） | Edit/Write 及变更类 Bash（`rm`、`cp`/`mv`、`>` 重定向、`tee`、`curl -o`、`tar -x`…）落在用户区目标 | 按"可回滚性"逐目标判定：脚本区（`~/.zcode` 根/tmp/workspace、系统临时目录）与记忆目录静默放行；git 已追踪文件放行（可 checkout 回来）；本会话 AI 新建的文件放行；**git 内未追踪的既有文件、非 git 目录的既有文件→拦一次核对路径拼写（防拼错+无回滚），重跑放行**；删目录用 porcelain 范围查 |
| 脚本内容扫描（v4） | 执行脚本区的脚本（`node`/`python`/`npx`…）且内容含破坏性调用（`rm`/`rmSync`/`sed -i`/`git push`…） | 拦一次核对脚本内部目标；重跑放行 |
| 就地修改 | `sed -i`、`perl -pi`、`git commit --amend`、`git rebase`、`git filter-branch`、`git stash pop`、`patch`/`git apply` | 每类每会话提醒一次：核对模式只命中预期内容，跑后 diff 自查 |

任务类型（v4）：ambient/系统消息与短续接不重置任务态；检查/审查/通读类无修改动词判**诊断**（默认零修改，首次修改性写注入诊断纪律 advisory）；关键词未命中判 unknown（首笔修改性写收中性对账）；漂移/对账/诊断**只计修改性写**——工具性/记忆/元配置写是读任务的健康探索，静默。完成断言证据门（v4B，M1）：回合末段含无对冲完成断言（修好了/绿了/is fixed…）且同轮无验证类命令→advisory 要求附证据链或改写为"预期完成，待验证"，每会话至多一次。

解析失败（变量、特殊引号、转不了的路径、git 缺失）一律放行——门禁只在"确认会丢东西"时拦，不确定不拦。

hook 归属：闸门有两个 harness 变体——`hooks/askfirst-gate.js`（ZCode）与 `hooks/askfirst-gate.dsh.js`（DSH），由 `hooks/test-sync.js` 守卫契约面同步。Claude Code 安装本 skill 得到的是软规则层（第 1-5 节）；CC 适配 dsh 变体的路径见仓库 README。
