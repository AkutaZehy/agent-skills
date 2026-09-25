---
name: strategic-coding
description: Strategic programming discipline for AI-assisted development - invest design effort in the contract face (names, public interfaces, why-comments), keep implementations rough, pay back debt on signals. Use when starting a project or top-level module, designing or naming an interface, writing comments, deciding where a module boundary goes, merging shallow modules, or refactoring with an agent. 触发词：战略编码、契约面、深模块、尽早注释、清晰命名、浅模块合并、重构纪律。
---

# Strategic Coding

Strategic programming (Ousterhout, *A Philosophy of Software Design*): invest in design to lower the cost of future change. Complexity = dependencies + obscurity; a deep module puts much behavior behind a small interface. In agent-assisted development the theory bites harder, because the interest on debt has changed form: a rough implementation no longer costs human reading time, it costs every future session the tokens to rebuild context around it. So design effort concentrates entirely on the contract face, and the implementation face is allowed to be rough — an agent can rewrite it cheaper than it can re-read it.

Design investment has no phase. It is a state of mind applied at every touch of the code (incremental design), not an activity done once at project start and again at a scheduled refactor. The two applications at the bottom are the same discipline at two moments.

## The contract face

Names, public interface signatures, and key why-comments are the contract face: what callers, teammates, and every future agent session actually read. Spend design effort here and keep it stable. Everything else is implementation face.

## Four disciplines

### Naming
- One concept, one word. Search the codebase before minting a name — consistency costs one grep. The project glossary is the single source (if the domain-modeling skill is installed, it owns the glossary). A second word for an existing concept is merged on sight — agents copy existing patterns and faithfully propagate a split.
- Name length is inversely proportional to scope: `i` is fine in a loop; an exported name carries full words.
- A name that won't come is an abstraction smell: run a refactor check on the concept instead of forcing a name.

### Comments
- Comments carry why, never what — a comment restating the code (`// increment i`) is deleted on sight; agents generate these by default.
- Two depths, both wanted: low-level comments buy precision (boundaries, units, why this approach over that one); high-level comments buy intuition (the contract, the design tradeoff). Interfaces get high-level; genuinely tricky internals get low-level.
- Public entry points get one line: the contract plus why it exists. Internals rely on naming. A comment that cannot say why concisely is the same signal as a name that won't come — the interface is the problem.
- Comments are written at contract time, when they are cheapest. A contract spanning files gets one line at the providing side — the consumer cannot see your assumptions. A behavior change triggers a pass over adjacent comments and a grep over referencing files — agents change code, not comments, so rot is the default.

### Modules
- Deep module: much behavior behind a small interface. Depth is a property of the interface, not the implementation — a module built of many small private parts is still deep.
- Depth is spent only at seams that get depended on: imported from many places, re-read by the agent every session. One-off helpers and glue stay shallow by design; forcing depth there is over-abstraction.
- Deletion test: imagine deleting the module. Complexity vanishing = it was a pass-through; merge it. Complexity reappearing across N callers = it was earning its keep.
- Context test (the AI-era form of the same idea): if one behavior requires opening more than ~3 files to locate or change, the interface is leaking — collapse it.
- New behavior goes into an existing module first; a new file needs a reason — agents default to creating files.
- Imports go through module entry points, never into another module's internals — a deep import reaches past the interface and turns the entry points into decoration.
- Dependency direction is declared, not discovered: presentation imports types and formatters from computation; computation never imports back. When the shortest path crosses a layer, the path is wrong, not the layering.
- Two adapters make a seam real; one adapter is indirection.

### Refactoring
- Signal-driven: the calendar opens nothing. The signals: a name that won't come; a comment that can't say why; the context test failing; one change fanning out across files. Mid-change, touching a fourth file for one behavior is the context test failing in motion — stop and report before continuing.
- Hot spots lead: `git log --oneline` frequency shows where depth pays; scan there first.
- Coverage before touching — the test-hygiene skill, when installed, owns test quality. When deepening, write tests at the new interface and delete the old shallow-module unit tests: replace, don't layer.
- A refactoring diff only moves code; new behavior is a separate change. Review agent refactoring diffs against this rule alone.
- Copying an existing module is a decision, not an accident: state whether it is an intentional fork or a candidate for extraction. Silent duplication grows into twins.
- Opportunistic payback: each iteration pays ~10% into the seam it just touched. Fast iteration with daily payback is the book's own recommendation; what kills codebases is fast iteration with zero payback.

## Two applications

### Starting (new project or top-level module): contract face first
1. Glossary first: name the core concepts, one word each, before writing code.
2. Interfaces before implementations: every module declares its public entry points — signature plus one-line why — before any body exists.
3. The skeleton stops at seams: directories are laid out around code that will be depended on; scripts and one-offs get no ceremony.
4. For load-bearing seams, design it twice: two genuinely different interface sketches, chosen with a one-line tradeoff note. Heavy version: parallel sub-agents per the DESIGN-IT-TWICE pattern in mattpocock/codebase-design, when installed.
5. Done when: every module has declared entry points, its concepts are glossary entries, and AGENTS.md/README carries a one-line pointer.

### Maintaining: signal-driven payback
1. A signal opens the work; the hot spot chooses where.
2. Baseline before, diff after: snapshot the test count, key metrics, and file list at task start and diff at close — drift that no single step reveals is still drift.
3. Order of operations: coverage → move → comment pass → doc sync.
4. Done when: the opening signal is gone, tests are green, and docs are synchronized — comments touched by the move updated, glossary terms renamed code-wide, README and design docs aligned. Doc sync is part of the definition of done, not a follow-up.

## Companion skills (referenced when installed)
- **test-hygiene** — refactoring's safety net: coverage rules, tautology cleanup, mutation testing.
- **domain-modeling** — owns the project glossary.
- **mattpocock/codebase-design** — deeper module vocabulary (seam, adapter, leverage, locality); **improve-codebase-architecture** — a full-scan orchestrator producing deepening candidates for the maintaining loop.

## Out of scope
- Up-front design of everything: contract-face-first stops at seams; it is not waterfall.
- Test-writing rules themselves: test-hygiene owns those.
