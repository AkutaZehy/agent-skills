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

## 检索路由与离线处理（实务细则）

- 保真度阶梯：markdown / txt / log / 少量代码 > 可读图片（原生识图）> PDF、大量代码。能拿文本版就不做图片分析，能实证就不猜。
- arXiv 论文优先抓 HTML 全文（`python -m markitdown https://arxiv.org/html/<id>v1`，表格成真 markdown），PDF 是拿不到 HTML 时才选；abs 页查摘要；论文附带代码回仓库看，图片/PDF 落盘走离线处理。拿到可 grep 的文本才算第一步完成。
- 看仓库（读代码、调研写法）：gh cli 直取（gh api / gh search / gh repo view）。
- 读新闻/调研事实：搜索拿线索，网页抓回文本，只留关键段落。
- 联网工具路由：模型有原生检索就直接用、不绕工具；否则 CLI 优先（gh 等结构化输出），再是 free-search-mcp（search/research 搜索、fetch 抓正文/文档、read_doc 读 PDF/office、paper_graph 论文引用图），fetch MCP 专守 raw 直取/长页分页；两者被拒（403/超时）→ web_reader（服务端渲染急救，按次计费）→ 浏览器 → 仍不行停下问用户。
- 前端/渲染/交互类问题：读代码不如开浏览器看实际效果；代码结果分析以实际执行输出为准。大量代码和 PDF 对"效果类问题"是间接证据，必要时用执行/识图校验。
- 离线分型处理：文本/代码=grep 定位 + 精准读命中窗口（整篇整本进上下文是最后手段）；本地 PDF=`pdftotext -enc UTF-8 -layout x.pdf -` 抽文本再 grep（双栏分离好；ISO-8859 输出 grep 加 `-a`），markitdown 兜底（慢、双栏交错），仅扫描版（无文本层）用 Read 识图；图片=Read 原生识图（markitdown 的 OCR 缺 Azure key，不指望）；office/epub/HTML/URL=markitdown 首选（`pip install "markitdown[all]"`），docx/pptx/xlsx 表格转 markdown 质量好。
