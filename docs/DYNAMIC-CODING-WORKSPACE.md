# Request-driven coding workspace

User clarification: 28 October 2026. This is a required Phase 2 workflow.

The product must not require a predefined problem bank. The user requests a
question by topic, name, full statement or selected resource, and the application
prepares the coding workspace for that request. Saved problems can be reused,
but a fixed catalog is not the entry requirement.

## User-selectable problem sources

Revised by the user on 31 October 2026. The DSA entry flow has three choices:

1. **Choose from my notes:** one Markdown/text file per question, grouped in
   topic folders. Import individual files or a notes root folder, browse topics,
   use keyword search across question names/topics/full note text, preview and
   explicitly select one question. Only that question is sent to the model, which
   prepares the starter template and public tests while preserving its statement.
2. **Question or topic:** name a known question or describe a topic. ChatGPT
   frames the problem and prepares the workspace. A complete pasted statement is
   supported within this choice and must be preserved when marked as complete.
   A named question recalled by a model is not a verified published copy.
3. **Surprise me:** ChatGPT chooses and prepares a question at the interview's
   level, optionally constrained by a topic preference. No mandatory prompt is
   required. This is model selection, not random selection from the note library.

No embedding/vector RAG pipeline is required for this organised question library.
Keyword search remains available as a direct local filter, including text inside
files. Choosing a question is always explicit; search never silently sends notes.
Unrelated files remain local. Empty results never silently switch to generation.

Folder import previews the topic/name mapping before saving, accepts .md/.txt,
allows up to 100 files per batch and 20,000 characters per question. Batch imports
are atomic. Existing notes migrate into an Unsorted topic without losing content.
The editor uses a dark default, with an explicit persisted light/dark preference.

## Preparing the workspace

Create a validated problem/workspace description containing the statement,
source references, examples, constraints, language, entry point, starter code,
input/output format and test configuration. Render it using the application's
editor and test components; do not execute model-generated interface code.

Adapt the editor files, function signature, class or stdin/stdout harness to the
particular problem. Python is the first executable language; other requested
languages require an available runner or a clear unsupported-language message.
Preserve user code when changing workspace details and require an explicit new
attempt/version for incompatible problem changes. Do not include the solution in
starter code unless the user explicitly chooses a learning/review workflow.

Validate examples and generated test expectations before scoring. Distinguish
source-supplied tests, generated tests and captured execution results. Generated
tests are not an authoritative judge for an arbitrary problem; allow inspection,
correction and uncertainty. Keep private tests separate where configured and
do not send them to candidate-visible model prompts. Run submitted code only
through the isolated Docker runner with resource limits.

Persist the selected problem version, retrieved context, code, tests, outputs,
transcript and assessment together. The interviewer can then ask follow-ups
about the user's actual implementation and measured failures. Continue the same
interview's ChatGPT conversation while local application history remains authoritative.

## Phase sequencing and acceptance

Phase 2 includes topic-based question import, browsing and keyword filtering.
Keep complete files and explicit selection/provenance. The broader cross-mode
knowledge library remains in Phase 4; it is separate from this direct selection flow.

Internal deterministic fixtures are for testing the runner and validators only.
They must not become a mandatory user-facing question set.

Verify direct pasted questions, named-question retrieval, ambiguous/no matches,
topic-based generation, and prompt-free surprise questions. For each
route, verify the correct editor harness, examples, isolated execution, saved
problem/code versions and evidence-linked report. Test failed generation,
incomplete source material and incorrect generated test expectations without
inventing a successful result or silently changing sources.


## Automatic interviewer context — 31 October 2026

Every coding interviewer turn (opening, answer and retry) includes the selected
problem, current editor text including unsaved/incomplete code, and the latest
server-recorded run. The inline interviewer passes its current editor value;
the Conversation tab restores the local draft. No manual code-sharing click is
required. Context is captured when a turn starts; edits during a response are
included on the next turn, not injected into an already running response.
Typing alone does not issue model requests or execute code.

The backend validates the workspace/session/revision, retrieves run evidence
itself, and labels whether the run's exact code matches the current draft.
Turn snapshots are immutable, linked to assistant messages, stored locally and
included in session exports. Sharing a draft does not save over the workspace's
code revision or mark the attempt as submitted. Gateway follow-ups carry the new
snapshot in the same chat without replaying the whole interview history.
Unrelated notes are excluded. Prompt context is data, never executable instructions.

Assessment evidence now accepts exact quotes from saved candidate messages or
captured code/run/explanation source IDs. Submission is explicit and immutable;
final reports do not silently grade a working draft as submitted code. See
SUBMISSIONS-AND-ASSESSMENT.md for the implemented submission/review workflow.
