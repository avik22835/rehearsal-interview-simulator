# Phase 2 coding workspace — submission and assessment checkpoint

31 October 2026. Phase 2 remains in progress.

Current source flow (revised 31 October 2026):
- Choose from my notes: one .md/.txt file per question, organised by topic. Folder imports preview names/topics and save atomically. Existing notes remain available in Unsorted.
- Question or topic: ChatGPT frames the requested question; complete pasted statements can be marked for exact preservation.
- Surprise me: ChatGPT chooses at the interview level, with an optional topic preference.
- Keep keyword search across question names, topic names and full note text, combined with the topic filter. Explicit selection determines the one file sent to the model; no vector RAG is required for this flow.
- The editor and its controls now default to dark; light/dark remains an explicit persisted preference.

Implemented (earlier checkpoints below retain their verification history):
- DSA opens in Coding workspace rather than immediately choosing an unrelated question.
- Pasted input, model generation, resource retrieval, and grounded generation all prepare the same validated problem contract.
- Local text/Markdown resources can be imported, searched by keywords, selected and previewed. Complete problem documents (up to 20,000 characters) are retained with source provenance. This is document-level lexical retrieval, not vector search or general PDF/repository ingestion.
- Remote preparation requires an active compatible/gateway interview and explicit sharing consent. Resource-only preparation preserves the selected source statement; missing selections are rejected.
- Monaco loads from local assets; plain-text fallback remains available. Local drafts, saved revision checks and immutable snapshots preserve code; explicit problem changes retain older workspaces.
- Docker runner supports function, Class.method, and stdin/stdout contracts. Fixed missing interactive stdin flag. Tests use immutable image IDs, no network, non-root user, bounded resources and read-only mounts.
- Public example results and errors are stored with code snapshots, and included in session exports. Current editor text and latest run evidence now accompany each interviewer turn automatically, including unsaved drafts.

Verification:
- 39 API tests passed, including five opt-in real Docker tests for function/class/stdin, timeout and read-only filesystem enforcement.
- Frontend production build and TypeScript pass.
- Headless Edge UI check with temporary database and a controlled local model passed all four preparation routes, local source import, Monaco editing and a real Docker example run, with zero page errors.
- Initial browser test typed malformed code during editor initialization; changed Monaco to uncontrolled initial content, reran the complete flow successfully. Runner correctly retained the syntax error in the failed test result.
- Verification screenshot: local ignored data/coding-workspace-browser.png.
- Real desktop ChatGPT workspace verification recorded separately when complete; controlled model checks do not prove the browser provider works.

Remaining Phase 2 work:
- Wider arbitrary-problem and clarification flows, broader custom test editing and optional private tests.
- Broader real-model evaluation of the DSA rubric and adversarial citation/expectation cases; code/run-linked assessment is now implemented.
- Larger library management and richer source formats where needed; broader cross-mode retrieval belongs to the later library work.
- Additional browser checks for cancellation, reload/conflict recovery and long-running generation; accessibility/layout refinements.
- Broader execution workflows for backend, project and design modes remain required.

Launch: powershell -ExecutionPolicy Bypass -File .\scripts\Start-Desktop.ps1
Keep Docker Desktop running. WSL and Docker installation is verified separately in local data/docker-boot-diagnosis.md.

Live desktop verification passed on 31 October: ChatGPT generated a valid workspace (Add Two Integers, add entry point, four examples), the app Docker runner passed all four, and starting the interviewer preserved the same ChatGPT conversation and asked a contextual clarification about the selected problem. Evidence is local ignored data/coding-live-verification.json. The synthetic verification interview remains clearly named Workspace connection verification in history. Real resource-grounded/model-only broad problem coverage remains to be expanded.


## Coding workbench redesign — 31 October 2026

The coding interview now uses a compact navigation rail and a focused workbench: independently scrolling problem details, a resizable Monaco editor, a docked testcase/result/history console, and an optional interviewer pane. Source selection uses four descriptive choices. Editor focus, font size, light/dark editor, restore/undo, Ctrl+Enter and Ctrl+S are available. Run and Save stay visible on laptop screens; narrow screens stack the panels.

Custom cases accept JSON positional/named arguments and expected values, or stdin/stdout text. Inputs are validated before execution; oversized or malformed cases do not create runs. Custom examples apply only to their run and never overwrite the prepared problem. Saved runs expose their immutable code revision; the UI warns when results do not match current code. Example checks remain debugging aids, not a complete correctness judge.

Validation: 48 API tests passed including real Docker execution. Production build and TypeScript passed. Isolated headless Edge exercised all four preparation routes, resource import, Monaco editing, public/custom Docker execution, invalid JSON rejection, editor settings/focus, keyboard pane resizing, and laptop/mobile layouts, with zero page errors. Screenshots are under ignored data/coding-workspace-{browser,laptop,mobile}.png and data/coding-source-picker.png. These controlled-provider tests do not constitute another live ChatGPT provider check.

Design references: LeetCode's official coding workspace/testcase documentation and HackerRank's candidate coding-question layout. This implements the workspace interaction patterns while retaining Rehearsal's visual theme and interview flow.


Three-choice flow validation: 50 API tests pass including real Docker checks, existing-library migration, atomic folder imports, topic/content keyword filters, selected-file-only model input and prompt-free random generation. Isolated headless Edge verifies actual folder upload (.md/.txt), topic selection, keyword filtering, exact selected-note statement preservation, question-name generation, surprise generation, dark editor default, public/custom Docker runs and laptop/mobile layouts. Production build and TypeScript pass. This uses a controlled local provider, not a new live ChatGPT test.


Application-wide dark theme (31 October): shared dark surface/text/accent tokens now cover the launcher, navigation, setup/forms, settings, history, library, all interview tabs, assessment views and the coding workbench. Native form controls/scrollbars, browser theme metadata and Electron native theme/window background follow the same default. Production build and five desktop host checks pass. Isolated Edge visual checks cover nine main screens plus the coding/source-library flow with no browser errors and no unintended large light surfaces; laptop/mobile layouts remain usable. See DESIGN.md for the palette.


Theme correction: dark surfaces now use neutral black/charcoal (#0b0b0b / #141414 / #101010 / #202020), replacing the earlier green-tinted palette. The top-bar sun/moon control toggles the interface to light/dark, persists the preference locally, and restores it before initial paint. Desktop appearance synchronizes through a bounded, trusted-renderer-only theme IPC bridge after the next app launch. Theme switching does not change interview/code state. Browser checks pass for switching, navigation/reload persistence, mobile layout, and both coding palettes; build, desktop syntax and existing host-policy checks pass. DESIGN.md is the current palette reference.


Automatic interviewer context checkpoint: editor drafts, selected problem and
server-owned run results now accompany each coding turn. Exact code comparison
marks stale results, and schema version 5 persists immutable per-turn snapshots
without modifying saved code or candidate speech. Export includes those snapshots.
53 API tests pass including Docker, provider prompt packing, session/revision
boundaries and draft preservation. Controlled-provider Edge verification inspected
actual opening/follow-up/Conversation-tab prompts, confirmed all three unsaved
drafts and exported snapshots, and passed the existing coding/library workflows
with zero page errors. Production build and TypeScript pass. No additional live
ChatGPT provider check was performed for this change.


Submission checkpoint: schema 6 freezes code, selected problem, explanations and
public-example execution per submitted attempt. Live feedback, submission reviews
and final reports support exact-quote citations into saved answers or captured
code/run/explanation sources. Source buttons inspect immutable artifacts; stale
runs cannot score current drafts. Missing evidence remains unassessed. Reports
name any attempt coverage omitted for prompt size. Submit is idempotent, failed
runs remain inspectable, cancelled reviews can be retried, and export includes
attempts/manifests. See SUBMISSIONS-AND-ASSESSMENT.md for workflow and endpoints.

Controlled-provider Edge verification passed the full flow with actual Docker:
submitted multiplication for an addition problem produced 6 instead of 5, then
editor changes did not alter the reviewed code or captured run. Code/run citation
inspection, final report and export passed with zero page errors. Existing note
imports, keyword/topic filters, named/surprise questions, automatic draft context,
theme switching and laptop/mobile checks also passed. Production build passes.


Final verification: 61 API tests passed including real Docker tests. Review
cancellation/retry, forged citations, session deletion and large-history coverage
limits passed. The final built Edge flow passed code/run source inspection and
final-report/export validation, along with prior coding/library/theme checks.

Live personal-desktop ChatGPT verification passed on 31 October: a clearly named
Verification · submitted-code assessment interview prepared an addition problem,
executed all four public examples successfully, and produced a submission review
with seven validated source citations and a final report with eight. Both used
the same bound ChatGPT conversation. Local ignored evidence is
 data/submission-live-verification.json. This representative case verifies the
connection/protocol, not model judgment quality for every arbitrary problem.
