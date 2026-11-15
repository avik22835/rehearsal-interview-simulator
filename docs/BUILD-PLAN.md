# Interview Simulator build roadmap

The agreed product baseline is ../PROJECT-BRIEF.md. The complete original
requirements are in product-spec.md. Gateway debugging history is supporting
integration material; it does not replace the product scope.

## Agreed product

Complete local-first personal interview workspace with DSA, project deep dive,
system design, backend, AI/ML/LLM, and resume/behavioral modes. A polished study
experience is part of every phase. No mode has priority over the final scope;
the sequence below follows technical dependencies.

Architecture decision, 28 October 2026: proceed with the Electron desktop host
and managed ChatGPT view as the selected direction. Preserve the complete feature
roadmap below. First complete the feasibility and migration gates in
[Desktop architecture](DESKTOP-ARCHITECTURE.md); do not pursue side-panel,
injected-overlay or split-screen alternatives as parallel product directions.

Stack: Next.js/TypeScript UI, FastAPI/Python backend, SQLite with migrations,
isolated Docker code runner, CPU-only offline speech adapters. ChatGPT Gateway
is an external browser relay; generic compatible endpoints and mock mode remain
supported. Never put browser login credentials in simulator storage.

User-confirmed product addition: ChatGPT browser tools can be used during an
interview, with the resulting answer relayed back into the app. The user has
observed Python code checks working. Plan optional tool-assisted study across
all modes, with capability checks and clear execution provenance. Detailed scope
and acceptance: [Tool-assisted interviews](TOOL-ASSISTED-INTERVIEWS.md).

## Phase 0: Gateway integration baseline (live-verified)

- [x] Clone the user-selected bridge into vendor/chatgpt-gateway.
- [x] Add incremental SSE delivery and replacement events for browser text revisions.
- [x] Preserve non-streaming responses.
- [x] Bind to loopback, reject overlapping browser turns, propagate cancellation.
- [x] Report incomplete timeouts explicitly, fix new-chat message counting.
- [x] Automated server integration tests with a simulated extension.
- [x] Verify a fresh-chat response reaches the terminal cleanly and ends with SSE [DONE] on the user's real logged-in tab (extension 1.0.5).
- [x] Verify multiple live content updates before completion: extension 1.0.7 delivered 8 updates and [DONE] in the dedicated fresh-chat test.
- [x] User confirmed 11 incremental updates and DONE on extension 1.0.7.
- [x] Verify app pause cancels an active gateway request, preserves the answer, and permits retry after automatic extension reconnection.
- [ ] Explicitly test a fully closed/disconnected ChatGPT tab during Phase 3 voice/recovery integration.

Baseline reached: real streamed first/follow-up responses and user-side verification.
Remaining cancellation/recovery checks are explicitly tracked above; they must
pass before those product controls are considered finished. Proceed with Phase 1.

## Phase 1: Foundation and visual system

Build the app shell, navigation, mode selection, session setup, settings,
provider adapters, capability report, deterministic mock provider, SQLite
migrations, persisted interview state/events, pause/resume, and typed dialogue.
Create typography, spacing, colors, focus states, reduced motion, responsive
layouts, loading/error/empty states, and a focused study workspace from the start.

Gate: a mock and gateway-backed typed session can be started, paused, reloaded,
resumed, and ended without losing history; state/provider tests pass.

Implemented in Rehearsal v0.1: six-mode responsive shell, setup, settings, provider
adapters, capability check, local schema version 2, persisted messages/events,
partial-reply recovery, session history/search/filter/export, live feedback and final
transcript-grounded assessments. Gateway chat bindings persist per interview.
Twenty API/provider tests and the frontend typecheck/build pass. Browser mock
flow passes; a live gateway opening and contextual follow-up reached the app.
See PHASE-1.md for run instructions and the current verification record.
Gate passed: mock and live gateway sessions were paused, reloaded, resumed,
retried and ended with history intact. Live cancellation used the relay's
automatic connection-reset fallback; its acknowledgement limitation is recorded
in PHASE-1.md. No manual extension reload was needed for the successful retry.

## Phase 2: Coding interview workspace

Problem import that preserves user text, Monaco, Python runner in an isolated
Docker container, resource limits, visible/private tests, code snapshots,
adaptive follow-ups, DSA rubric, and evidence-linked reports. The workspace is
request-driven, with three choices: a question selected from topic-organised notes,
a named question/topic (including pasted text), or a model-chosen surprise question. A predefined problem bank is not required. Use deterministic
fixtures internally to verify execution/validation, not as the user-facing flow.

Include folder/file import, topic browsing and local keyword search in Phase 2.
No embedding RAG pipeline is needed for the organised DSA question library. Adapt starter files, function signatures,
input/output harnesses and tests to each selected/generated problem. Preserve
source statements and label generated material. See
[Dynamic coding workspace](DYNAMIC-CODING-WORKSPACE.md).

Define execution-evidence records for saved code and test inputs. Add optional
ChatGPT-assisted code checks, counterexamples and debugging after candidate
reasoning/submission. Keep the local Docker runner as the reproducible execution
path; label assistant-reported remote results separately from captured test output.

Gate: pasted, retrieved and generated problem -> matching workspace -> code ->
tests -> submit -> evidence-linked report. Verify ambiguous/no-source handling;
timeouts and malicious/accidental runaway code stay outside the API process.

## Phase 3: CPU-only offline voice

Implement the separately recorded voice design: push-to-talk, local STT,
editable transcript, plain spoken turns, local TTS, pauses, playback controls,
and cancellation. Benchmark on the actual Windows laptop. Speak only stable
sentence segments when streaming; retain whole-answer playback as a fallback.

Tool-assisted replies get concise spoken summaries; code, logs and tables remain
visual. Waiting for remote tools must be interruptible without invented progress.

Gate: offline speech after model installation, usable latency measurements,
responsive editor, and complete typed fallback.

## Phase 4: Knowledge and grounded interviews

Consented folder/repository ingestion, path/secret exclusions, parsers,
collection management, lexical/vector retrieval, metadata/citations, retrieval
inspection, and project/backend/AI modes with distinct rubrics.

Add capability-gated ChatGPT analysis of explicitly selected sources/data, small
Python experiments, evaluation metrics and research citations. Validate imported
artifacts and source evidence before using them in reports; the bridge currently
delivers assistant text rather than a structured tool/artifact stream.

Gate: selected sources determine retrieval; excluded files stay excluded;
questions and reports cite actual indexed evidence.

## Phase 5: System design and resume interviews

Editable architecture canvas, diagram snapshots/export, structured diagram
context for non-vision models, resume/JD parsing, claim locations, story bank,
behavioral coaching, and mode-specific evaluations.

Offer tool-assisted capacity calculations and scenario analysis for design,
plus grounded resume/JD comparisons and evidence-based metric checks for behavioral
practice. Preserve assumptions and source-located claims.

Gate: both modes complete real sessions with persistent artifacts and evidence.

## Phase 6: Product completion and polish

Cross-session trends/comparison, history search, delete/export, backup/restore,
accessibility and performance review, provider compatibility checks, long-session
testing, and Windows installation/setup documentation.

Verify tool availability/fallbacks, remote/local execution disagreements, artifact
provenance/export, same-chat continuation after tools, and cancellation/timeouts.
Use the acceptance cases in TOOL-ASSISTED-INTERVIEWS.md before declaring this
extension complete.

Gate: verify every acceptance criterion in the original product specification
across all six modes. Earlier checkpoints do not constitute full product completion.

## How we work

Keep each change reviewable. End every phase with what works, tests run, known
limitations, and the exact launch command. Record unresolved integration issues
here. External model requests need clear controls over the documents sent.
Do not expand into distributed infrastructure or multi-agent architecture.

## Current checkpoint and next action

1 November coding-driver extension: optional per-question model-generated Python
adapters preserve node/class/in-place APIs and are inspectable in a Driver tab.
Docker run snapshots retain the exact driver source and fingerprint. See
[Python question drivers](CODING-DRIVERS.md) for coverage, checks and limits.

The Electron managed ChatGPT provider, typed sessions, local note library, dynamic
coding editor and Docker runner are implemented. The coding loop now includes
explicit frozen submissions, repeat-safe public-example execution, submission
reviews, and live/final assessments with validated code/run/answer citations.
See [Phase 2](PHASE-2.md) and [Submissions](SUBMISSIONS-AND-ASSESSMENT.md).

The representative coding loop is browser-verified with real Docker and a controlled
model, and live-verified through desktop ChatGPT: four public examples passed and
submission/final assessments retained validated source citations in the same chat. Continue broader arbitrary-problem/real-model checks and keep optional
private tests distinct from generated public examples. Reliability checks cover
pause/cancel, failed review retry, draft preservation, export and session boundaries.

Phase 3 initial voice checkpoint is implemented: CPU English recognition, editable
push-to-talk transcripts, sentence-based neural speech, speed/volume/replay/stop,
and shared current-code context. Synthetic offline and real HTTP/native-worker
checks passed. Quick voice synthesis measured about 0.6 seconds and short STT
about 2–3 seconds in the warm HTTP check. Expressive Kokoro voices remain a slower
option. See [Voice design and evidence](voice-and-gateway-design.md).

1 November: opt-in hands-free now starts listening after complete question playback
and automatically sends a local transcript plus current code after a configurable
pause. Thinking hold and manual review remain available. Synthetic browser tests
cover automatic turn cycling, current unsaved code and cancellation.

Next: real microphone/acoustic acceptance for pause detection, long-session/provider
failure checks, then the remaining practical workspaces. Continuous partial input
and automatic interruption during interviewer playback are not yet implemented.
All six modes and later source-backed practical workspaces remain in scope.
