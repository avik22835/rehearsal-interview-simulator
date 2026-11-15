# Personal Interview Simulator --- Product Specification for Codex

> Architecture decision, 28 October 2026: use an Electron desktop host with the
> existing interview UI and a managed ChatGPT browser view. All previously agreed
> features remain required. See [Desktop architecture](DESKTOP-ARCHITECTURE.md)
> for component boundaries, sign-in/background feasibility gates and migration.

> User-confirmed addition, 27 October 2026: optional tool-assisted interviews
> through the linked ChatGPT browser conversation. The user observed tool use,
> including Python checks, with the resulting answer returned to the simulator.
> See [Tool-assisted interviews](TOOL-ASSISTED-INTERVIEWS.md) for cross-mode uses,
> phase delivery and acceptance criteria, and [the agreed brief](../PROJECT-BRIEF.md)
> for current decisions. Dedicated tool/artifact integration remains planned;
> text relay does not establish verified execution. The original specification
> below is retained.

## 1. Goal

Build a local-first, single-user interview practice workspace for a
software engineering student preparing for SDE, backend, AI/ML
engineering, and LLM infrastructure interviews.

The system must support multiple distinct interview modes, spoken
conversation without requiring a camera, adaptive follow-up questions,
evidence-based scoring, and persistent progress tracking. The user will
provide an OpenAI-compatible model endpoint; do not hard-code a provider
or require a direct OpenAI API key.

This is a practice and coaching tool, not a covert live-interview
assistance tool.

## 2. Core design principles

-   Local-first: user documents, code, transcripts, and interview
    history stay on the user's machine by default.
-   Provider-agnostic LLM interface: configure a base URL, model name,
    and optional credential. The user's separately configured
    browser-session bridge may expose an OpenAI-compatible endpoint, but
    the application must not assume every bridge supports streaming,
    tool calls, vision, or structured output.
-   Explicit capability detection: display which features are supported
    by the configured model endpoint.
-   Real interview flow: one question at a time; the interviewer
    listens, asks follow-ups, and adapts to the user's answer.
-   Evidence-based evaluation: cite transcript excerpts, code snapshots,
    test results, retrieved files, or diagram elements. Do not invent
    evidence.
-   User-controlled context: choose repositories, folders, notes,
    resume, job description, and individual problem statements per
    session.
-   No camera required. Microphone input and spoken output are optional;
    typed mode must always work.

## 3. Modes

### Mode A --- DSA / coding interview

User clarification, revised 31 October 2026: no mandatory predefined problem set.
Offer three paths: select a question from topic-organised Markdown/text notes,
provide a question name/topic or paste its text, or let ChatGPT choose a surprise.
Keep local keyword search across question names, topics and note text. Selecting
an uploaded question is explicit; ChatGPT receives that one question to prepare
its template and tests while preserving the source. This organised library does
not require embedding/vector RAG. Use a dark editor by default. See
[Dynamic coding workspace](DYNAMIC-CODING-WORKSPACE.md) for detailed requirements.

Inputs: - Paste a problem statement or provide a URL / local Markdown
file. - Optionally provide constraints, examples, hints to hide, and
expected language. - Allow user-created problems as well as imported
problem text. - Do not depend on scraping a site that blocks automated
access; pasted problem text is the reliable fallback.

Interview flow: 1. Interviewer presents the problem in a problem card.
2. Candidate asks clarifying questions. 3. Candidate explains brute
force and complexity. 4. Candidate discusses an optimization and
correctness invariant. 5. Editor unlocks or remains available according
to configuration. 6. Candidate writes code, runs visible tests, views
stdout/stderr, and submits. 7. On submit, run hidden tests where
configured and available. 8. Interviewer asks relevant follow-ups based
on the solution, complexity, edge cases, and candidate's own reasoning.
9. Produce a scorecard and review timeline.

Editor/runtime: - Use Monaco Editor or an equivalent mature editor. -
Start with Python 3 support; keep language execution behind a runner
interface. - Use Judge0 or another isolated execution service/container.
Never execute arbitrary candidate code inside the main web-server
process. - Clearly distinguish local/public tests from hidden evaluation
tests. - Show test inputs, expected/actual output, exceptions, runtime
and memory where available. - Capture timestamped code snapshots on
edits/submission and associate them with transcript segments.

Problem generation: - If only a topic is supplied, ask the LLM to create
a complete problem with title, statement, constraints, examples, starter
code, and test cases in a validated JSON schema. - If the user supplies
a problem, preserve its statement and examples; do not silently replace
the problem. - The LLM must not receive hidden test answers if the goal
is genuine assessment. Generate private tests separately and store them
outside the visible prompt/context where feasible.

### Mode B --- Project deep dive / GitHub portfolio interview

Inputs: - Add one or more Git repository URLs or local repository
paths. - Add README, docs, architecture diagrams, ADRs, wiki exports,
issue/PR exports, and selected code folders. - Support manual
selection/exclusion of paths and a rescan button. - Never index secrets,
`.env`, tokens, private keys, dependency directories, build output, or
large generated files.

Ingestion: - Clone or read repositories only with explicit user
permission. - Respect access controls and do not upload source code to a
cloud provider without clear user consent. - Parse Markdown, text,
source code, configuration files, and supported PDFs. - Build a
searchable index with metadata: repository, path, symbol/function/class,
commit hash, and line range. - Support lexical search plus vector
retrieval; optionally rerank results. - Keep source citations in every
retrieved chunk.

Interview behavior: - Generate questions about architecture, design
choices, alternatives, trade-offs, failure modes, bottlenecks, security,
tests, deployment, observability, and measured results. - Ask
increasingly difficult follow-ups based on the candidate's previous
answer. - Ask the candidate to explain specific code paths and how
components interact. - Verify claims against indexed source and docs. If
repository evidence is missing, ask rather than fabricate. - Distinguish
what the code actually implements from what the README claims. - Score
ownership, technical depth, correctness, trade-off reasoning, clarity,
and ability to acknowledge limitations.

### Mode C --- System design

Inputs: - Choose a topic or provide a prompt. - Optional constraints:
traffic, latency, availability, cost, data retention, geographic
scope. - Optional reference notes or a target role/level.

Interview flow: 1. Requirements and clarifying questions. 2. Scale
estimates and key SLOs. 3. API and data model. 4. High-level
architecture. 5. Deep dives into bottlenecks, consistency, caching,
queues, sharding, failure recovery, security, and observability. 6.
Trade-off challenge and alternative design. 7. Final review.

Whiteboard: - Provide a canvas with boxes, connectors, labels, and
exportable diagram JSON/SVG. - Allow the interviewer to refer to
specific components and edges. - If model vision is unavailable, send
structured diagram data and a textual summary rather than pretending to
inspect an image. - Store diagram snapshots alongside transcript events.

### Mode D --- Backend engineering

Use a user-provided topic list and retrieved notes. Support topics such
as: - HTTP, REST, authentication/authorization, API versioning, rate
limiting - SQL, indexes, transactions, isolation, query planning,
migrations - Redis, caching, invalidation, queues, retries,
idempotency - concurrency, async execution, connection pools,
backpressure - distributed systems, consistency, fault tolerance,
observability - Docker, CI/CD, deployment, security, testing, production
debugging

Ask conceptual questions, scenario questions, code/debugging questions,
and design follow-ups. Increase difficulty based on answers.

### Mode E --- AI / ML / LLM engineering

Use a user-maintained topic catalogue and notes. Example topic
families: - embeddings, chunking, retrieval, reranking, vector stores,
RAG evaluation - transformer and attention internals, inference,
batching, KV cache - fine-tuning, LoRA/PEFT, data quality, evaluation,
quantization - tool calling, agents, MCP, workflow orchestration,
guardrails - latency, throughput, cost, caching, observability,
tracing - model evaluation, hallucination analysis, prompt injection,
privacy - ML fundamentals, experiment design, data leakage, deployment

The interviewer should distinguish conceptual knowledge from
implementation knowledge, ask for trade-offs and failure analysis, and
request code or architecture where appropriate.

### Mode F --- Resume / behavioral interview

Inputs: - Resume PDF/DOCX/Markdown and optional job description. -
Optional personal story bank and project index.

Features: - Parse resume claims into structured facts with source
locations. - Ask "tell me about yourself," project questions, ownership,
conflict, failure, prioritization, impact, and role-fit questions. -
Drill into metrics, exact contribution, alternatives, evidence, and
lessons learned. - Do not invent accomplishments or improve answers by
fabricating facts. - Generate STAR-style feedback while preserving the
user's actual experience. - Flag unsupported resume claims for the user
to verify.

## 4. Shared knowledge base and retrieval

Create separate logical collections: 1. Resume and job descriptions. 2.
Project repositories and documentation. 3. Backend engineering notes. 4.
AI/ML/LLM engineering notes. 5. System design notes. 6. Personal
interview history and weak areas.

Requirements: - User chooses which collections are enabled for each
session. - Chunk code by symbol/function/class when possible; chunk
Markdown by headings. - Store metadata and source path/line range/commit
hash. - Hybrid retrieval: keyword/BM25 + embeddings; optional
reranking. - Display retrieved sources to the user before or during the
interview. - Avoid mixing unrelated collections. A DSA session should
not retrieve personal resume details unless explicitly enabled. - Add,
remove, re-index, and inspect sources through the UI. - Provide a "why
was this retrieved?" explanation and a relevance score. - Support a
"notes only" mode where answers and question generation must be grounded
in selected notes. - Retrieval is context, not unquestionable truth; the
interviewer should challenge contradictions and identify missing
evidence.

## 5. Voice experience

-   Browser microphone capture with visible recording state and
    push-to-talk as the initial safe default.
-   Speech-to-text adapter interface: browser speech recognition or
    local Whisper/faster-whisper.
-   Text-to-speech adapter interface: browser speech synthesis or local
    Piper.
-   Display transcript live or near-live and let the user correct
    transcription errors.
-   Spoken questions and spoken follow-ups; typed fallback always
    available.
-   Optional barge-in/interrupt support if the selected TTS stack
    supports it.
-   Keep audio processing local by default; explain any external
    processing.
-   No camera or avatar requirement.
-   Voice pipeline must not block the code editor or test runner.

## 6. LLM/provider adapter

Define a provider interface with: - `generate(messages, options)` -
`stream(messages, options)` when supported - optional structured JSON
output - optional tool calls - optional image input

Configuration UI: - provider type / compatible endpoint URL - model
identifier - optional API credential - timeout and retry settings -
test-connection button - capability report

The app must work with mock/deterministic mode for UI development. Do
not assume a browser-session gateway implements every OpenAI API
feature. Add a compatibility test page for ordinary prompts, streaming,
long context, JSON output, and timeout behavior.

Do not store session cookies or automate login. The browser-session
bridge is an independently configured external adapter. Keep the core
application provider-agnostic.

## 7. Interview state machine

Represent the interview as explicit phases:
`setup -> context_loading -> introduction -> clarification -> answer -> follow_up -> coding (optional) -> evaluation -> report`.

Persist events: - question shown - transcript segment - candidate
response - code snapshot - test run and result - diagram snapshot -
retrieved context references - follow-up and score - final evaluation

The interviewer should never skip phases unpredictably. Add pause,
resume, end session, and repeat question controls.

## 8. Evaluation and progress

Each mode has a different rubric. Do not use one generic score for all
modes.

DSA: - problem clarification - brute-force baseline - key observation -
invariant/correctness - complexity - code quality - edge cases -
communication

Project deep dive: - architectural understanding - implementation
depth - ownership - trade-offs - failure modes - evidence accuracy -
clarity

System design: - requirements - scale estimation - architecture -
data/storage choices - bottleneck analysis - reliability/security -
trade-offs

Backend / AI engineering: - conceptual accuracy - implementation depth -
trade-off reasoning - production awareness - debugging -
security/reliability - communication

Resume/behavioral: - specificity - truthful ownership - structured
storytelling - impact/evidence - reflection - relevance to role

Reports must include: - overall and per-dimension scores - evidence
citations to transcript/code/source files - what was correct - what was
missing or vague - one improved explanation based on the user's actual
reasoning - recommended next practice topics - repeated weakness trends
across sessions

## 9. Recommended implementation stack

Prefer a modular monorepo: - Frontend: Next.js + TypeScript - Editor:
Monaco - Backend: FastAPI (Python) or a well-structured Node backend;
avoid duplicating business logic across both without need - Database:
SQLite initially; migrations included - Retrieval: local vector index
plus lexical search; keep an adapter boundary so it can be replaced -
Code execution: Judge0 or an isolated Docker runner - Speech: browser
APIs first, with optional Whisper and Piper adapters - Tests: unit tests
for state machine, retrieval filters, scoring schema, provider adapter,
and code-runner API - Packaging: Docker Compose where practical, plus
Windows-friendly setup instructions

Do not start with Kubernetes, distributed deployment, a custom vector
database, or a complex multi-agent architecture. This is a single-user
local application first.

## 10. Security and privacy

-   Never execute candidate code in the API server process.
-   Apply CPU, memory, process, and wall-clock limits to code execution.
-   Exclude secrets from indexing.
-   Bind local services to loopback by default.
-   Keep credentials out of source control and logs.
-   Require explicit confirmation before indexing private repositories
    or sending code/documents to a remote model.
-   Provide delete/export controls for indexed data, transcripts, and
    sessions.
-   Do not build stealth assistance for use in employer interviews where
    AI assistance is prohibited.

## 11. Build plan for Codex

Build incrementally; do not generate the entire application in one pass.

### Phase 1 --- Foundation

-   Inspect the repository and write an implementation plan.
-   Build setup, mode selection, local persistence, provider adapter,
    and mock provider.
-   Implement interview state machine and event history.
-   Add tests before continuing.

### Phase 2 --- DSA coding mode

-   Add problem form, problem card, Monaco editor, Python execution
    adapter, visible tests, submission results, code snapshots,
    transcript panel, and DSA rubric.
-   Use deterministic sample problems first.
-   Confirm that arbitrary user-supplied problem text can become a valid
    session without relying on scraping.

### Phase 3 --- Voice

-   Add microphone capture, transcription adapter, TTS adapter,
    transcript correction, and interruption/pause controls.
-   Verify typed-only mode remains fully usable.

### Phase 4 --- Knowledge ingestion and RAG

-   Add folder/repository import, secret/path exclusions, parser,
    indexing, hybrid retrieval, source citations, and retrieval
    inspection UI.
-   Add project deep-dive, backend, and AI/LLM modes driven by selected
    collections.

### Phase 5 --- System design and resume

-   Add architecture canvas and diagram snapshots.
-   Add resume/JD ingestion, behavioral mode, claim verification, and
    role-specific scoring.

### Phase 6 --- Quality

-   Add session comparison, weakness trends, exports, backup/restore,
    accessibility, performance tests, and Windows setup documentation.
-   Test with a range of short and long sessions and with a model
    endpoint that does not support streaming.

At the end of each phase, report what works, tests run, known
limitations, and the exact command to launch it.

## 12. Acceptance criteria

The first usable release is complete when: - I can paste any DSA problem
and receive a problem card without losing the original statement. - I
can write Python in an editor, run visible tests, submit, and inspect
errors. - I can explain my reasoning by voice or text. - The interviewer
asks follow-ups based on my actual answer and code rather than a generic
script. - I can import a local project repository and selected notes,
then get source-grounded project questions. - I can choose separate DSA,
project deep dive, system design, backend, AI/LLM engineering, and
resume modes. - I can configure an OpenAI-compatible endpoint without
changing application code. - I can see a final report with evidence and
actionable feedback. - The app remains useful without voice and without
a cloud LLM through mock mode. - All user data is local by default, with
clear controls for any external model requests.
