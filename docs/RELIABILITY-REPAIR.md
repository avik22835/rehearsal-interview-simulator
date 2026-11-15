# Interview reliability repair — 27 October 2026

## Observed failures and repairs

The Project deep dive final assessment was valid JSON inside a complete
`<escape>` presentation wrapper. The original parser rejected it. The parser now
removes complete recognized escape or JSON code-block wrappers, then performs
the same strict schema, rubric and exact candidate-quote checks. Unknown wrappers,
trailing text and invented citations still fail. The existing report was recovered
from its saved response without another model request; the old failed attempt and
a database backup are retained locally.

A valid next question previously failed with its feedback if assessment validation
failed. Question completion and feedback validation are now independent. Errors
appear in Feedback with a separate latest-answer repair control. Repair does not
append another candidate answer or regenerate the interviewer question. Completed
raw model outputs are stored in a local SQLite table, omitted from session exports.

The fetch response observer previously checked its turn before awaiting a body
read, but not after it. A cancelled read could therefore deliver old text to a new
turn. Both response resolution and every body read now verify the captured token.
The WebSocket observer excludes local control sockets. Content-script failures
release their active-turn state, and dispatch checks for an orphan page operation
before submitting a new prompt.

Terminal network snapshots complete immediately instead of waiting for the DOM
fallback's stability polls. Questions remain spoken-first text and stream before
feedback JSON. Live feedback requests have smaller explicit output budgets.
The Next proxy's `no-transform` SSE fix is retained. Upstream generation latency
is not controlled by these changes; no output is artificially split to claim
incremental streaming.

## Verification boundary

Automated cases cover recognized report wrappers with strict forged-quote
rejection, question completion despite bad feedback, separate feedback repair
without transcript duplication, local raw-output persistence, late cancelled
fetch bodies, and excluded local sockets. The frontend production build passes.

The live Edge 1.1.1 check ran with the browser fully minimized throughout, as
confirmed by the user. Two independent interviews received different chat URLs;
two follow-ups and a final report used the first interview's original URL. The
first follow-up exposed separately escaped delimiter and JSON blocks; that parser
case is now fixed and tested. Separate feedback repair passed, and the next turn's
automatic feedback passed strict validation. Its spoken question arrived in four
updates beginning at 4.812 seconds; the whole turn completed at 8.156 seconds.
The final report preview began at 4.812 seconds and validated at 25.172 seconds.
These are individual observations, not latency guarantees.

A second live check cancelled an active turn, then immediately started a new
interview. Cancellation was acknowledged in 0.078 seconds; the new interview
completed in a fresh chat with zero pending relay requests. Short opening questions
sometimes arrived in one update, so those turns establish background delivery,
not incremental streaming by themselves. Evidence is stored locally in ignored
`data/reliability-verification.json` and `data/cancellation-reliability.json`.
Previous single-opening checks on 1.1.0 did not establish repeated-turn reliability.
Chrome uses the same Chromium extension but has not been live-tested here.
