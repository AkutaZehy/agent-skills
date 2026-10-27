---
name: memory-hygiene
version: "1.0.0"
description: Use when writing or editing memory files (auto-memory MEMORY.md and per-project memory/*.md), when a session produced decisions worth persisting, or when the user asks to review/curate/prune memories. Enforces positive framing, terminal-state over narrative, and size budgets so memories stay load-bearing instead of becoming session logs. Also governs functional prose (READMEs, plans, reports, docs): pair imperative negatives with a same-sentence positive alternative; human-voice prose (blogs, diaries) stays exempt.
---

# Memory Hygiene

## Scope boundary: memory, functional prose, human-voice prose

These rules govern memory files, whose reader is a future model session. Human-facing writing is not one bucket — the 2026-10-25 audit split it into two tiers:

**Functional prose (README, plans, reports, docs, to-doc products) inherits the core disciplines.** The reader wants the current truth, so terminal-state-over-narrative applies: record what is; migration/process narrative ("原先存 os.tmpdir()，后改落 …") belongs in a changelog or a decision note, not a README. Imperative negatives ("不要手动编辑此文件") are allowed when they guard a real edge case, but pair the positive alternative in the same sentence ("请用生成器重建；不要手动编辑") — an unpaired "不要xxx" is exactly the dirt form the 2026-10-25 audit found accumulating in plan/report docs. askfirst-gate's 功能文卫生 advisory warns on the unpaired form at write time.

**Human-voice prose (blog posts, diaries, personal-site copy) stays exempt.** Do not export these rules there: first-person emotion, narrative, and even complaints are trust-building assets, not pollution. A sanitize pass that strips voice from human-facing prose trades real credibility for a uniform AI register — and typically keeps the AI-flavored filler ("旨在/痛点/闭环"-style corporate fallback) while deleting exactly the lived experience a reader trusts. When reviewing a tone-down rewrite, audit it with the same suspicion as generated text, and restore the voice. The priming rationale stands: a human reader is never "primed" by a complaint the way a model is by a negative instruction — the functional-prose pairing rule exists for precision and terminal-state clarity, not for priming.

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

## Where a memory goes

Three buckets, chosen by where the fact stays true:

- **Global** (`projects/default-<id>/memory/`): preferences, cross-project norms, environment facts and cross-project references — anything a session in any workspace must be able to recall.
- **Project** (`projects/<project>-<hash>/memory/`): operational rules and facts that hold only inside that project.
- **Sandbox** (`draft-*`): auto-memory for one conversation. No other session reads it, so treat it as scratch.

Promotion: copy a sandbox memory into the global bucket only when it is cross-workspace reusable and not one-off. A constraint that held for one conversation (a quota limit, a one-session instruction) stays in the sandbox and is not typed `feedback`.

## The index is a build artifact

`MEMORY.md` is rendered from frontmatter by `tools/memory-index.py`; the generator is the only writer. The index carries the always-read tier (`type: feedback` and `type: user`); every other memory stays out of it and is found by grep over the bucket.

- To change what a line says, edit the file's `title` or `description`, then regenerate.
- `python tools/memory-index.py --check` exits 0 when the index matches and 1 when it has drifted; run it before reading the index and rebuild on 1.
- `supersedes: <name>` marks that a newer memory replaces an older one. Both files stay on disk and the index shows the newest; retiring a memory means superseding it, not waiting for a date.

## Archiving changes visibility, not location

A memory leaves the index by being filtered out at generation time; the file stays in `memory/` and remains reachable by grep. A physical move into `memory/archive/YYYY-MM/` is reserved for content confirmed dead (a closed deadline, a superseded decision) — only then does the default grep scope stop seeing it.

## Size budgets

- Single memory file: soft cap ~8KB. When an update would push a file past it, rewrite the file to terminal state and move the full history to `memory-archive/<name>.md` (sibling of memory/, never indexed) — archive is the fallback, the live file must stand alone.
- MEMORY.md index line: one line, ≤120 chars, what-it-is + current status + pointer. The index is loaded every session; a 5000-char index line is a memory file pretending to be an index.
- Index file: ≤10KB total. Extra detail lives in the memory files, reachable via one Read.
- Functional docs (READMEs, plans, reports) carry budgets too: when one is over, relocate content to its owning tier first, condense what stays second, raise the budget last. Ceilings are guardrails, not reduction targets.

## Update mechanics

- Prefer Edit over Write for incremental changes; prefer a full rewrite (Write) when the file has become a log — restructure to: current state → decisions → gotchas → pointers.
- Keep frontmatter valid: `name`, `description`, `metadata.type`. The description is the recall hook — make it say what the memory is for, positively, without dumping the whole content into it.
- After editing memories, sync the MEMORY.md index lines in the same turn.
- Session-scoped churn (file paths that changed, build hiccups, mid-conversation back-and-forth) stays out of memory unless it generalizes.

## Review pass (when asked to audit)

1. Size: `wc -c */memory/*.md` — anything over the ~8KB soft cap is a rewrite candidate.
2. Negative density: grep for 不要|禁止|避免|不得|别再|严禁|never|don't — each hit is a rewrite candidate unless paired with its positive alternative.
3. Narrative smell: grep for 被点名|教训|作废|浪费|错误|事故 — keep the rule, compress the story.
4. Stale hooks: expired deadlines, superseded versions, "待办" already done — update or delete.
5. Structural damage: frontmatter interrupted by body text, stray line-number prefixes (e.g. a literal `29\t`), broken list lines in MEMORY.md.
6. Verify against the session log when a memory claims "user said/decided" — in ZCode, rollout files live under `~/.zcode/cli/rollout/`.
