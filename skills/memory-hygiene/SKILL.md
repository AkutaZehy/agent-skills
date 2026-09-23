---
name: memory-hygiene
description: Use when writing or editing memory files (auto-memory MEMORY.md and per-project memory/*.md), when a session produced decisions worth persisting, or when the user asks to review/curate/prune memories. Enforces positive framing, terminal-state over narrative, and size budgets so memories stay load-bearing instead of becoming session logs.
---

# Memory Hygiene

## Scope boundary: memory only, not human-facing prose

These rules govern memory files, whose reader is a future model session. Do not export them to writing for humans (blog posts, docs, READMEs, release notes): there, first-person emotion, narrative, and even complaints are trust-building assets, not pollution. A sanitize pass that strips voice from human-facing prose trades real credibility for a uniform AI register — and typically keeps the AI-flavored filler ("旨在/痛点/闭环"-style corporate fallback) while deleting exactly the lived experience a reader trusts. When reviewing a tone-down rewrite, audit it with the same suspicion as generated text, and restore the voice. Negative-word hygiene (positive framing) stays memory-only; a human reader is never "primed" by a complaint the way a model is by a negative instruction.

Memories are injected into every future session. Each line you write either steers behavior or pollutes it. These rules come from a 2026-09-13 audit across 10 projects / 91 memory files that found three failure modes: memories that grew into append-style session logs (one file reached 134KB across 55 appends, one was rewritten 136 times in a single session), negative instructions that prime the exact mistakes they warn against, and vivid failure stories that re-inject the failure.

## What belongs in memory

Persist: user preferences and feedback (with the user's own words), durable project decisions and their rationale, terminal states (what shipped, what was decided, current numbers), reusable gotchas with their trigger condition, references to external resources.

One memory = one topic. Update the existing file instead of creating a near-duplicate; hard-delete memories that turned out wrong.

## Write rules

**State the behavior, not the ban.** LLMs have no suppression mechanism — "don't do X" injects X as an active concept. Rewrite:

- "提交前禁止包含本机绝对路径" → "对外内容用相对路径与占位符书写" (the grep checklist stays as a tool section, not the rule itself)
- "不要把探索过程当交付物" → "交付物=可行动结论，过程只留一行路径记录"
- "不得使用 state_dict 的 requires_grad 过滤" → "存/载 ckpt 一律 named_parameters()+键名过滤"

When a negative constraint is unavoidable (true edge cases, existing-behavior warnings), pair it with the positive alternative in the same sentence: "margin 门被否——用地板-only（顶分 <15 → null）".

**Terminal state over narrative.** Record the decision and its final numbers, not the path of revisions. Iteration history belongs in one line: "终版=加权平均式（过程三案被否，详见归档）". A memory describing round 1→55 of a strategy reads as noise by round 20; the reader needs the round-55 answer plus which constraints produced it.

**Minimal failure traces.** A lesson earns its place by its trigger condition and detection method, not by how badly it went. Keep: the rule, the one-line evidence ("30K 训练作废" suffices), the check that catches it early. Drop: multi-paragraph incident reconstructions, blame/tone words ("被点名批评", "连续三轮", "浪费"), and verbatim bad examples (one masked reference is enough — a quoted bad commit message re-teaches the bad pattern every recall). The user's verbatim words for preferences and standards are the exception: quote them, they are ground truth.

**Gate predictions behind the evidence.** Record uncertainty as uncertainty ("归因收敛到 X 或 Y，未分解"), and retire guesses the moment data lands — a disproven hypothesis left in memory re-fights the battle next session.

## Size budgets

- Single memory file: soft cap ~8KB. When an update would push a file past it, rewrite the file to terminal state and move the full history to `memory-archive/<name>.md` (sibling of memory/, never indexed) — archive is the fallback, the live file must stand alone.
- MEMORY.md index line: one line, ≤120 chars, what-it-is + current status + pointer. The index is loaded every session; a 5000-char index line is a memory file pretending to be an index.
- Index file: ≤10KB total. Extra detail lives in the memory files, reachable via one Read.

## Update mechanics

- Prefer Edit over Write for incremental changes; prefer a full rewrite (Write) when the file has become a log — restructure to: current state → decisions → gotchas → pointers.
- Keep frontmatter valid: `name`, `description`, `metadata.type`. The description is the recall hook — make it say what the memory is for, positively, without dumping the whole content into it.
- After editing memories, sync the MEMORY.md index lines in the same turn.
- Session-scoped churn (file paths that changed, build hiccups, mid-conversation back-and-forth) stays out of memory unless it generalizes.

## Review pass (when asked to audit)

1. Size: `wc -c */memory/*.md` — anything >15KB is a rewrite candidate.
2. Negative density: grep for 不要|禁止|避免|不得|别再|严禁|never|don't — each hit is a rewrite candidate unless paired with its positive alternative.
3. Narrative smell: grep for 被点名|教训|作废|浪费|错误|事故 — keep the rule, compress the story.
4. Stale hooks: expired deadlines, superseded versions, "待办" already done — update or delete.
5. Structural damage: frontmatter interrupted by body text, stray line-number prefixes (e.g. a literal `29\t`), broken list lines in MEMORY.md.
6. Verify against the session log when a memory claims "user said/decided" — in ZCode, rollout files live under `~/.zcode/cli/rollout/`.
