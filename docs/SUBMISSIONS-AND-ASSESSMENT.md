# Submitted attempts and captured evidence

Implemented checkpoint: 31 October 2026. Python remains the executable language.

## User workflow

Open Coding workspace → Submit attempt (or the Submissions console tab). Add an
optional explanation and choose Submit & run examples. This saves the exact code,
selected problem, explanation and existing answer IDs, then executes the problem's
public examples in Docker. The frozen attempt survives failed/cancelled runs.

Choose Review submitted attempt for a model assessment. Reviewing does not end the
interview. Later editor changes do not change the submitted attempt, its tests or
a previous review. Saved submissions remain selectable across problem changes.
Ending an interview produces a final assessment over saved answers and submitted
attempts; it does not silently submit an unfinished working draft.

## Evidence and verification

Assessment citations accept saved candidate message IDs or captured source IDs.
Each submitted attempt has code, recorded-run and optional explanation sources.
Live feedback can cite the exact working draft captured for its turn. Its run is
labelled stale if the tested code differs; stale runs cannot support current-code
scores. Quotes must be exact substrings of server-owned sources in that assessment.
Unknown IDs, changed quotes and cross-session source access are rejected.

Citation buttons open the captured source, not the current editor. Code is shown
with line numbers. Sources load on demand; normal session polling returns metadata.
Reports declare omitted attempt counts when a large history exceeds the prompt
budget. An omitted attempt can still receive its own explicit review.

Scores remain model judgments. Public-example expectations are model-prepared;
passing them is not a full correctness proof or private-test judge. Complexity
analysis is reasoning, distinct from measured container-run elapsed time.

## Persistence and recovery

Schema version 6 adds coding_attempts and assessment_sources. Submit requests have
an idempotency key; retrying the same key/payload does not rerun or duplicate it.
Changing that payload requires a new key. Session/workspace/revision boundaries
are checked. Pause/cancel keeps the frozen attempt, and startup marks unfinished
runs/reviews interrupted. Reviews can be retried against the same saved evidence.
All attempts and complete assessment manifests are included in session export.
Deletion of an interview also removes its attempts and evidence through foreign keys.

## API

- POST /api/sessions/{session}/coding/submit: freeze and run public examples.
- GET /api/sessions/{session}/coding/attempts/{attempt}: inspect frozen content/run.
- POST /api/sessions/{session}/coding/attempts/{attempt}/review: streamed assessment.
- GET /api/sessions/{session}/assessments/{assessment}/sources/{source}: read a captured source.
- Existing feedback/report routes include the relevant evidence manifests.

## Verification

API coverage includes immutable/idempotent submissions, live draft citations,
review repair, forged-source rejection, cross-session isolation, failed execution,
review cancellation/retry, deletion/export and large-history coverage limits.
The isolated Edge flow uses real Docker execution with a deliberately failed
example, edits afterward, source inspection, and final-report/export validation.
Controlled model fixtures validate plumbing, not the quality of an actual model's judgment.


Final checkpoint: production build and 61 API tests pass. A live desktop ChatGPT
addition interview passed four real Docker examples, source-validated submission
review and final report, retaining the same ChatGPT chat. The named verification
interview is retained in history; its local evidence record is
 data/submission-live-verification.json. Broader arbitrary-problem evaluation,
optional private tests and voice remain separate work.
