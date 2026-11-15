# Saved ChatGPT conversations and assessments

The simulator now binds each interview to one ChatGPT conversation. Start a new
interview to create a new chat. Follow-up turns and the final report return to
that saved chat, even if another ChatGPT chat is currently selected.

## Requests and persistence

The first request supplies the interview instructions, mode, topic, rubric, and
response format. Following requests contain only the latest candidate answer
with its message ID, the current phase, and the task. A retry asks to retry the
previous turn without resending the candidate's answer. A final report is another
task in the same chat. The app no longer repeats the entire transcript on normal
gateway turns.

The app stores the ChatGPT URL and binding state in SQLite (schema version 2).
The relay also persists session-key bindings in data/gateway-conversations.json,
including the original tab/document before a new chat has its final URL. A missing
binding produces an explicit error instead of silently starting another chat.
ChatGPT Gateway extension 1.0.8 / protocol 3 is required.

Compatible chat-completions endpoints remain stateless: their requests still
include history because they do not use the ChatGPT browser conversation.

## Live feedback and final report

Interview turns now return the spoken question first, then a plain metadata
delimiter and feedback JSON. The question streams immediately; assessment JSON
is kept separate. Older JSON envelopes are still supported. Future text-to-speech
can consume the question without reading metadata. See background-streaming.md.

After a completed candidate/model turn, open **Feedback** to see strengths,
improvements, observed rubric dimensions and next practice steps. Citations
link to exact saved candidate answers. Ending the interview opens **Report** and
requests a final assessment automatically. Report generation has progress,
cancellation, explicit failures, and retry controls. Opening a previously ended
session does not automatically send another model request.

Reports include per-dimension scores from 0 to 5 when evidence supports a score;
otherwise the dimension is marked not assessed. These are model judgments about
the transcript, not verified code behavior or hiring-readiness measurements.
The server rejects unknown message IDs, nonmatching quotes, scores without
evidence, and final reports that omit rubric dimensions. Demo sessions and
sessions without candidate answers do not receive invented scores.

Feedback and report records, their errors, and transcript citations survive
reloads and are included in the session JSON export. A failed report never
deletes the transcript or replaces a previously completed report.

## Older interviews

Sessions created before conversation binding may not have their original browser
chat URL. The Feedback/Report view offers **Link the original ChatGPT conversation**.
Paste the original https://chatgpt.com/c/... link. This reuses that chat; it does
not copy the interview into a new chat. Once linked, a session cannot silently
switch to another chat.

On the first request in an upgraded older chat, the app installs the new response
contract and supplies candidate message references once so reports can cite the
old answers. Normal follow-up requests then use only the new answer.

## Verification

Automated tests cover session isolation, binding mismatch rejection, old-extension
and missing-binding failures, incremental question decoding, exact-quote
validation, live feedback persistence, report failure/retry, JSON export,
unscored demo reports, and manual-link validation. Live verification evidence is
saved under data/continuity-verification.json when that check completes.

Speech, Docker execution, imported sources and cross-session progress remain
separate build phases.


Live verification passed on 27 October 2026: one browser chat URL was preserved
across an opening retry, two answers and a final report. Both live feedback
records had exact transcript citations; all five final rubric dimensions were
present. Each spoken question streamed in two updates. The final report completed
in about 16 seconds. Updated checks: 26 app tests and 39 gateway tests passing. Frontend
typecheck and production build pass.

Extension 1.1.0 adds live-verified Edge background delivery and fixes gzip buffering
at the local web proxy. See background-streaming.md for setup and measured evidence.
