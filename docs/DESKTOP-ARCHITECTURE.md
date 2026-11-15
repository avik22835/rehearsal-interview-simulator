# Selected architecture: Electron desktop interview app

Decision confirmed by the user: 28 October 2026.

## Direction

Build Rehearsal as a Windows Electron application with our existing interview
interface and a managed ChatGPT browser view inside one desktop host. This is
the selected approach for future ChatGPT integration. Do not pursue browser
side-panel, injected-overlay, or split-screen alternatives as competing product
directions. The existing Edge extension/relay remains a migration reference and
temporary working fallback, not the target architecture.

This changes the host and ChatGPT transport, not the product scope. Preserve all
six interview modes, polished UI/UX, isolated local Python execution, CPU-only
offline voice, knowledge ingestion/retrieval, diagrams, resume/JD workflows,
live feedback, final reports, progress/history, and optional tool-assisted study.
See [the brief](../PROJECT-BRIEF.md), [roadmap](BUILD-PLAN.md) and
[tool-assisted workflows](TOOL-ASSISTED-INTERVIEWS.md).

## Components and responsibilities

- Electron owns desktop lifecycle, process startup/shutdown, the ChatGPT view,
  request routing, cancellation and connection diagnostics.
- Reuse the Next.js/React interface as the primary interview workspace.
- Keep FastAPI authoritative for interview orchestration, prompt contracts,
  assessment validation, provider adapters and business rules.
- Keep SQLite and local artifact storage authoritative for session history.
- Host ChatGPT using a separate WebContentsView and a persistent dedicated
  browser session. Expose its panel for sign-in, account prompts, tool inspection
  and troubleshooting; keep the interview interface central during practice.
- Keep the local Docker runner separate from both browser renderers and the API
  process. Keep future speech work in bounded CPU workers.

Initially retain the existing provider request/event protocol. Implement a desktop
adapter that replaces the browser extension's role. Keep the loopback relay if it
reduces migration risk; consolidate redundant transport only after parity tests.
Do not rewrite the interview engine just to change its browser host.

## Browser lifetime and conversations

Investigate backgroundThrottling=false for the hosted ChatGPT content to address
browser scheduling and visibility-related stalls. This is a control to verify,
not a guarantee that upstream requests or website behavior cannot stall.
Test minimized, covered, collapsed and restored views independently; do not assume
an unattached or zero-sized view behaves like a minimized attached view.

Every new interview gets a new ChatGPT conversation, including when the previous
interview was not ended. Follow-ups, tool requests, feedback and reports stay in
that interview's bound conversation. Session identity and saved state belong to
the app, not to whichever browser view happens to be open.

Carry request IDs through dispatch, streaming, completion and cancellation.
Preserve streamed revisions and partial text. Never repeat an ambiguously
submitted request automatically. Show only observable states; tool usage must not
produce invented progress or verified execution claims.

## Authentication and isolation

First verify a supported sign-in route and persistent sessions in the desktop
host. Do not assume existing Edge login transfers. Federated authentication can
restrict embedded browsers, so successful sign-in is a feasibility gate before
full migration. Do not copy cookies, spoof the browser to bypass authentication
restrictions, or assume external-browser login signs in the embedded session.
If blocked, record the specific blocker and discuss the next supported step
with the user rather than silently changing the selected architecture.

Keep remote content sandboxed, context-isolated and without Node integration.
Use narrow IPC messages with validated senders and bounded data. ChatGPT must
not receive general filesystem, Docker or database access. Preserve selected-input
sharing controls and keep credentials out of source, logs and simulator records.

## Delivery gates

1. **Host feasibility:** ChatGPT loads; supported sign-in works; session persists
   across restart; account prompts and navigation can be handled visibly.
2. **Background behavior:** repeated first/follow-up turns succeed while covered
   and minimized, after idle periods, and after collapse/restore. Measure memory,
   CPU and latency on the user's i7/16 GB laptop. No dedicated GPU is required by
   the product, and performance claims require actual measurements.
3. **Transport parity:** opening, incremental text/revisions, tool-assisted reply,
   cancellation, timeout, disconnect and crash recovery reach the existing backend.
4. **Interview continuity:** fresh chat for each new interview, same-chat resume,
   live feedback, final report and saved history survive restart without duplicate
   submissions or cross-session output.
5. **Desktop integration:** reuse the full app, add the connection panel, owned
   service lifecycle and recovery controls. Resume the existing feature phases.
6. **Windows delivery:** package runtime dependencies, installer, startup/shutdown,
   updates and data preservation. A desktop wrapper alone is not a complete installer.

Current status: the Electron host and built-in gateway adapter are implemented.
The simulator uses the desktop endpoint on port 18791. Hosted sign-in survived
restart; minimized incremental streaming, separate interview chats, same-chat
follow-ups, live feedback/final report, cancellation recovery and hidden-panel
streaming passed live checks. No browser extension is needed inside Electron.
See [Desktop checkpoint](DESKTOP-CHECKPOINT.md) for evidence and remaining gates.
These successful runs do not establish indefinite or universal reliability.
