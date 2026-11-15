# Personal Interview Simulator — agreed project brief

Updated: 1 November 2026. This is the concise project baseline for future work.
The complete requirements remain in docs/product-spec.md. User decisions below
refine that specification. docs/BUILD-PLAN.md tracks phase delivery; detailed
gateway debugging history is reference material, not the project's main scope.

Selected direction: an Electron desktop app hosting our interview interface and
a managed ChatGPT WebContentsView in one application. This replaces the separate
Edge extension as the target ChatGPT connection. Preserve every previously agreed
feature. The desktop connection and repeated background operation have been
verified. Coding submissions and evidence-linked assessment are implemented.
The current checkpoint adds CPU-only offline voice, pending real microphone/accent
and listening acceptance. See [Desktop architecture](docs/DESKTOP-ARCHITECTURE.md).

## Product and definition of success

Build a complete, polished, local-first interview practice workspace for one
software engineering student on Windows. It must support all six interview modes,
adaptive conversation, optional voice, practical workspaces, grounded evaluation,
saved sessions, and progress over time.

All six modes are required. The user has not prioritized one mode above the
others. Phases follow implementation dependencies and provide reviewable working
checkpoints; they do not reduce scope or redefine an early checkpoint as the
finished product. A collection of disconnected demos does not satisfy the goal.

The experience should feel smooth, focused, and engaging enough for regular
study. Visual quality, accessibility, and usable interactions are part of each
phase, not a styling pass deferred until the end.

## The six interview modes

1. DSA/coding: preserve supplied problem statements, examples, and constraints;
   support pasted text/local Markdown and optional URL import with paste fallback.
   No required predefined problem bank: choose an exact question from topic-organised
   Markdown/text notes (with keyword search), name/describe a question or paste it,
   or let the model choose a surprise. No vector RAG is required for this library.
   Adapt the editor, Python harness and tests to the selected problem. Current
   drafts accompany interviewer turns automatically. Explicit submission freezes
   code, problem, reasoning and local test evidence; live/final assessment can cite
   saved answers, captured code and run observations. Do not treat generated example
   success as a complete correctness judge. Optional hidden tests and broader
   arbitrary-problem coverage remain separate. See docs/DYNAMIC-CODING-WORKSPACE.md
   and docs/SUBMISSIONS-AND-ASSESSMENT.md.
2. Project deep dive: import explicitly selected repositories and documentation;
   inspect real code paths, architecture, implementation, ownership, decisions,
   failures, tests, security, deployment, and measured results. Cite source paths,
   line ranges, and commits; distinguish documentation claims from implementation.
3. System design: requirements, scale, SLOs, APIs, data models, architecture,
   bottlenecks, reliability, security, and trade-offs. Provide an editable diagram
   canvas, snapshots, and JSON/SVG export. Models without vision receive structured
   diagram context; do not assume images can be understood.
4. Backend engineering: conceptual, scenario, coding/debugging, and production
   questions about APIs, databases, caching, queues, concurrency, distributed
   systems, security, testing, deployment, and observability, grounded in selected
   topics/notes where available.
5. AI/ML/LLM engineering: fundamentals, retrieval/RAG, embeddings, transformers,
   inference, tuning, evaluation, agents/tools/MCP, performance, observability,
   privacy, and production failures. Assess both explanation and implementation.
6. Resume/behavioral: resume/JD ingestion, source-located claims, personal story
   bank, role fit, contribution, conflict, failure, prioritization, and impact.
   Give STAR-style feedback while preserving actual experience; never invent
   achievements, metrics, evidence, or ownership.

## Shared interview experience

Choose mode, role/level, topic/problem, session settings, and permitted context.
The interviewer asks one focused question, waits for an answer, and follows up
based on the actual transcript and work. The application owns explicit interview
state; the model does not arbitrarily skip phases or declare actions complete.

Use the specification's lifecycle, with documented mode-specific transitions:
setup -> context_loading -> introduction -> clarification -> answer -> follow_up
-> coding when applicable -> evaluation -> report. Support repeated answer/follow-up
cycles, pause/resume, repeat question, end session, and recovery after app reload.

Persist questions, transcript segments, responses, retrieved references, code
snapshots, test results, diagrams, and evaluations as timestamped events. Keep
local interview history authoritative, including when the provider is a browser
bridge. Do not rely on one mutable browser tab as the session database.

Use distinct rubrics per mode. Reports show dimension scores, supporting evidence,
correct reasoning, missing/vague parts, an improved explanation based on the
candidate's real reasoning, and recommended next practice. Do not force a score
when the evidence is insufficient. Track repeated weaknesses and comparisons
across sessions as the history grows.

## Context and knowledge

Separate collections for resume/JD, projects/docs, backend notes, AI/ML/LLM notes,
system design notes, and personal practice history. The user explicitly chooses
the collections/sources enabled for a session.

Provide source selection/exclusion, preview, rescan/re-index, inspection, removal,
and notes-only grounding. Use heading-aware text chunks and symbol-aware code
chunks where possible, with source metadata. Support lexical plus vector search,
relevance inspection, and citations. Exclude secrets, dependency directories,
build outputs, and large generated files. Missing or conflicting evidence should
produce clarification or an explicit limitation, not a fabricated claim.

## Coding driver compatibility

Coding-driver update (1 November): Python workspaces may include a model-generated
adapter for node structures, stateful classes, in-place results or custom output
validation. Full driver/wrapper source and recorded-run snapshots are inspectable
in the Driver tab. This broadens Python support; it does not supply other languages,
SQL/Pandas environments or official LeetCode private judges. See docs/CODING-DRIVERS.md.

## Voice and output contract

The laptop has an Intel i7-1255U, 16 GB RAM, Windows x64, and no dedicated GPU.
Docker is installed. No camera is required; typed interaction always works.

Local CPU speech is installed: faster-whisper base.en/int8 for English recognition,
Piper Lessac for quick replies and selectable Kokoro expressive voices. Push-to-talk,
editable transcripts, sentence playback, stop/replay and speed/volume are implemented.
Synthetic offline and HTTP worker tests passed; real English speech with the user's
Hindi-native accent and subjective voice quality still need acceptance. See
docs/voice-and-gateway-design.md for measured latency and remaining limits.

Hands-free addition: enable once; complete interviewer playback automatically
opens the microphone, and a configurable silence interval ends/transcribes/sends
the answer with the current code. Default pause is 3 seconds, with thinking hold
and manual review controls. This is implemented with synthetic browser coverage;
real microphone/background-noise acceptance remains necessary.

Start with push-to-talk, visible recording, transcript correction, stop/replay,
speed/volume controls, and explicit interruption. Keep audio work outside the UI
thread and independent of the editor/test runner. Automatic barge-in needs its own
echo and microphone verification.

Interview speech uses short natural plain-text turns, normally one question at a
time. No raw Markdown, JSON, code fences, or spoken pause labels enter TTS. The
app schedules pauses and queues stable sentence segments; it must handle stream
revisions without speaking duplicated or retracted text. Detailed reports, code,
citations, and diagrams remain available visually. See the prepared prompt in
prompts/interviewer-spoken.txt and the voice design document for implementation.

## Model connection and privacy

The implemented initial connection is the user's independently logged-in ChatGPT
browser session through the locally cloned Draivix/chatgpt-gateway extension and
Node relay. Manual browser sign-in remains separate from the simulator.

The selected successor is the managed desktop ChatGPT view described above.
Desktop sign-in uses its own persistent browser session and requires verification.
Keep the existing bridge available during migration; do not expand it into a
competing side-panel or overlay product.

The simulator must also support ordinary OpenAI-compatible endpoints and a
deterministic mock provider. Configuration includes base URL, model, optional
credential, timeouts, connection check, and verified capability reporting. Do not
infer tool calling, structured output, vision, embeddings, or token usage from
working text streaming. Validate generated schemas and handle unsupported features.

Keep gateway-specific message packaging and protocol handling in one adapter.
The extension currently forwards only the last user message, so that adapter must
install instructions on the opening turn, then send the current task, chosen
evidence and latest answer to the same interview chat. Do not copy the full history
into a new chat for each request. Other providers should retain normal message roles. Browser-text streaming
is not the model's original token stream.

The user has observed ChatGPT browser tool use, including Python code checks,
with the resulting answer returning to the simulator. Add optional tool-assisted
interviews across the six modes: code checks, calculations, selected document/data
analysis, research where available, and targeted study exercises. This is a
user-observed capability; the current bridge returns assistant text, not structured
tool-call or verified execution artifacts. Keep local Docker execution and label
remote assistant-reported results separately. See
[Tool-assisted interviews](docs/TOOL-ASSISTED-INTERVIEWS.md) for workflows,
capability checks, privacy controls, evidence rules and delivery phases.

Local-first storage does not mean ChatGPT inference is offline: selected prompt
context sent through the bridge leaves the machine. Provide clear per-session
controls and obtain consent before sending private code/documents. Keep browser
cookies/passwords out of simulator storage, credentials out of source/logs, services
on loopback, and user data export/delete/backup controls in the final product.

Candidate Python code must run in a separate restricted container/service with
CPU, memory, process, network, and wall-clock limits. Never run it in the API
process. This is an interview practice/coaching tool.

## Architecture decisions

- Desktop host: Electron with separate app UI and managed ChatGPT WebContentsView.
- Frontend: reuse Next.js + TypeScript; a consistent component/visual system.
- Backend: FastAPI + Python owns interview orchestration and business rules.
- Persistence: SQLite with migrations and local artifact storage.
- Coding: Monaco plus an adapter to an isolated Docker Python runner.
- Retrieval: local lexical/vector indexes behind replaceable adapters.
- Speech: separate bounded CPU workers and replaceable STT/TTS adapters.
- Providers: gateway adapter, generic compatible adapter, deterministic mock.
- Packaging: Windows desktop installer and owned service lifecycle; Compose where useful.

Run the web/API locally during development, with Docker for isolated execution.
Keep API credentials/provider requests server-side. Avoid duplicated interview
logic in Next.js and FastAPI. No Kubernetes, distributed services, custom vector
database, or complex multi-agent framework is needed for this single-user app.

## UI/UX expectations

Provide a clear home/session launcher, six-mode navigation, context library,
provider/settings screens, session history, and progress reports. The interview
workspace should put the current question, response, and relevant practical tool
within easy reach: editor/tests for coding, source evidence for deep dives, canvas
for design, and claims/story context for behavioral sessions.

Use readable typography, coherent spacing/color, clear focus and recording states,
smooth restrained motion, reduced-motion support, and layouts usable on this
laptop. Loading, empty, disconnected, interrupted, and error states need real
design. Keep transcripts and evidence inspectable without overwhelming the active
question. Verify the working UI in a browser, not only via screenshots or mocks.

## Delivery sequence

0. Gateway baseline: working and live-verified. Carry remaining cancellation and
   disconnect/recovery checks into provider integration; no open-ended gateway
   feature expansion is part of the main product plan.
1. Foundation and visual system: repository/app setup, polished shell, six-mode
   selection, session setup, settings, provider/mock adapters, SQLite/migrations,
   explicit state/event history, streamed typed dialogue, pause/resume/reload.
2. Coding workspace: problem preservation/generation, editor, isolated Python,
   tests/submission, snapshots, adaptive DSA interview, mode-specific evaluation.
3. CPU voice: STT/TTS, correction, spoken output contract, stable sentence queue,
   pauses, playback/interruption, measured Windows performance, typed fallback.
4. Knowledge and grounded modes: ingestion, collections, retrieval/citations,
   and complete project/backend/AI interview workflows.
5. Design and behavioral modes: canvas/snapshots/export, resume/JD/story inputs,
   claim grounding, design and behavioral interview workflows/evaluations.
6. Completion: comparison/trends, exports, delete/backup/restore, accessibility,
   performance, long sessions, compatibility, Windows setup, and full acceptance.

After every phase: demonstrate working behavior, report checks and limitations,
provide launch instructions, and reconcile remaining work. All final acceptance
criteria must be verified across the six modes before calling the product complete.

## Actual status and next action

Implemented: cloned/modified gateway, loopback relay, partial SSE/revision events,
request serialization protection, cancellation plumbing, diagnostics, Windows
scripts, and prepared spoken interviewer prompt. Thirty-two automated gateway/
DOM tests pass. Live first/follow-up responses streamed; the user's latest run
reported 11 content updates followed by DONE on extension 1.0.7.

Phase 1 implementation: Rehearsal v0.1 now provides a Next.js/TypeScript app,
FastAPI API, migrated SQLite storage, six typed practice modes, provider settings,
deterministic offline demo, streamed replies, history, pause/resume/end, retries,
JSON export and session event history. Twenty-six API/provider tests pass; frontend
type checking and production build pass. A live gateway question and a contextual
follow-up were delivered through the app and persisted. Setup is in docs/PHASE-1.md.

Not implemented yet: dedicated coding workspace/runner, retrieval/imports, voice,
mode-specific artifact tools, artifact-based evaluation, and progress analysis.
Transcript-grounded live feedback and final reports are implemented, with exact
citation checks, mode rubric dimensions, missing-evidence handling and retries.
One saved ChatGPT conversation is used per interview; a live two-answer session
and final report were verified against the same browser chat. Gateway tests: 39.

Next dependency: the selected Electron host feasibility and transport migration,
then Phase 2 coding workspace, preserving the agreed full product scope. Further gateway changes should address concrete integration failures
rather than displacing the application. Keep cancellation/recovery limitations
and verification evidence in docs/PHASE-1.md and docs/BUILD-PLAN.md.

Background update: Edge delivery is verified with a hidden ChatGPT page using
extension 1.1.0. SSE gzip buffering is fixed; question text arrives before
feedback completes. Every new interview gets its own chat even if the previous
one was not ended. See docs/background-streaming.md for measured evidence.

Latest reliability update: extension 1.1.1 and the repaired API passed repeated
turns with Edge fully minimized, separate new-interview chats, same-chat follow-ups,
feedback recovery, automatic live feedback, final-report validation and cancellation
followed by a fresh interview with zero pending requests. Current automated checks:
31 API tests, 41 gateway tests, and the frontend build/typecheck. See
docs/RELIABILITY-REPAIR.md. Tool-assisted workflows are a newly recorded product
extension; their dedicated UI and artifact integration remain planned.

Desktop decision, 28 October 2026: proceed with docs/DESKTOP-ARCHITECTURE.md.
The user still reports intermittent background stalls with the existing Edge
bridge. The initial desktop host and native adapter are now implemented; minimized
streaming, chat continuity, feedback/reports and cancellation passed live checks.
The simulator uses port 18791. See docs/DESKTOP-CHECKPOINT.md for remaining gates.
