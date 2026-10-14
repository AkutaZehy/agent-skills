---
name: research-intake
description: Use for multi-source research, papers, long documents, repository surveys, or when retrieved material needs careful extraction before analysis. Prefer primary, high-fidelity sources and give the model only relevant evidence.
---

# Research Intake

Use this workflow when a task needs more than a quick fact lookup. For simple current facts, use the harness's normal search and citation tools without adding this process.

## Choose the source format

- Prefer primary sources: official documentation for product behavior, the repository for implementation conventions, and the paper or dataset itself for research claims.
- Prefer searchable text over screenshots or scans. For papers, check for an HTML or text edition before choosing a PDF. For repositories, inspect relevant files or structured repository metadata.
- Use the tools available in the current harness. Tool names and paths from another harness are examples, not requirements.

## Keep retrieval precise

- Capture long source material to a local file when the available workflow supports it. Search within that file and read matching sections with enough surrounding context to preserve meaning.
- For PDFs and office files, use available document extraction tools first. Use visual inspection when layout, charts, or scan quality affects the answer.
- Give the model only the evidence needed for the current question. Avoid returning an entire long document when a few relevant sections will answer it.

## Report evidence clearly

- Cite sources near claims when browsing. Distinguish a source's statement from an inference drawn across sources.
- For version, compatibility, pricing, policy, API behavior, or unfamiliar library claims, verify against current primary sources before presenting them as facts.
- If a source cannot be retrieved or its relevant passage cannot be checked, state that limit and continue with the evidence available.
