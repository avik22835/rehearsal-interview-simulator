# Local streaming changes

These are local modifications to the cloned gateway, not an upstream release.
The application itself is not built yet. Start with Phase 0 in BUILD-PLAN.md.

## Launch on Windows

From the Interview Simulator workspace:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Start-Gateway.ps1
```

The script runs the server in the current terminal. Stop it with Ctrl+C.
The WebSocket dependency has been installed with lifecycle scripts disabled.
For a fresh checkout, install vendor/chatgpt-gateway dependencies with
`pnpm install --frozen-lockfile --ignore-scripts` before launch.

In Chrome or Edge, open the extensions management page, enable Developer mode,
and load the unpacked vendor/chatgpt-gateway folder. If already installed,
reload the extension and refresh the ChatGPT tab. Sign in manually in the browser.
Keep the selected ChatGPT tab free of manual edits while requests are active.
Health: http://127.0.0.1:18790/health.

Connection troubleshooting: both the extension WebSocket and popup use
127.0.0.1 explicitly, matching the IPv4 loopback bind. Both manifests grant
the popup access to this HTTP endpoint. The server permits extension origins
and sends application-level keepalives every 20 seconds. Reload the extension
after manifest changes, refresh the ChatGPT tab, and restart the server after
server changes. Historical extension errors may remain until cleared.
Before dispatch, the relay checks matching tabs in active/recent order and
probes their content scripts. If a receiver is missing, it injects content.js
using the extension's existing scripting permission and probes again. It can
skip inaccessible tabs during this readiness check; it never retries another
tab after sending a real prompt. The popup Test Connection uses the same checks.
Fresh-chat navigation now happens in the background before prompt dispatch.
The relay waits for a different loaded document with a visible composer. The
content script never navigates during a request. It acknowledges receipt
immediately and sends progress/final results as separate runtime messages,
avoiding a long-lived asynchronous response channel across page navigation.
The `auto` model leaves the current model selection unchanged.
Response reading supports author-role markers, assistant turns, answer articles,
and scoped Markdown blocks. New-answer detection compares node identity and text
rather than requiring a larger wrapper count. Progress/final delivery requires a
background acknowledgement; retries and delivery failures are visible locally.
Popup Test Connection now includes response-reader diagnostics (selector, counts,
answer character length, and current stage) without copying the answer content.
GET /diagnostics provides a read-only inspection through the extension. It returns
composer and button attributes, text lengths, extension version, and the most
recent failed operation snapshot. It sends no prompt and never reads cookies,
credentials, draft text, or full page HTML. Extension version 1.0.1 and diagnostic
version 2 identify this instrumentation. Run scripts/Inspect-Gateway.ps1 to print
the result, or fetch the local endpoint directly. A server restart and extension
reload are required after installing this diagnostic update.

Live investigation on the user's Windows/Edge page found a newer ChatGPT layout:
the composer is a contenteditable DIV with role=textbox and label=Ask ChatGPT;
assistant author-role markers and Markdown classes are absent. The response
reader now supports virtualized turn contents and the observed answer sibling
beside .turn-action-controls in a .group container. Live read-only inspection
verified recognition of an existing 112-character answer with extension 1.0.3.
That established extraction, not successful streaming of a fresh response.

A fresh-chat test then found that the prompt disappeared before submission.
Version 1.0.4 reacquires the current composer and verifies the exact prompt
persists before submitting, with bounded retries for editor replacement during
hydration. Text insertion uses a scoped editing command rather than directly
replacing rich-editor HTML. A regression test simulates editor replacement.
Fresh-chat end-to-end verification of this update is pending.

Live verification with version 1.0.5 succeeded after refreshing the ChatGPT tab
to replace stale content-script contexts left by extension reloads. A fresh
chat returned a clean eight-sentence answer without prompt/transcript labels
and finished with [DONE]. A second longer test returned 1,267 characters and
[DONE] with no gateway error. That longer test produced ONE content update;
multiple intermediate browser text updates have not yet been established on
this layout. Do not describe these results as proven token-by-token streaming.
The local result is recorded in data/gateway-live-verification.json.

After future extension updates, reload the extension AND refresh ChatGPT before
testing. Re-injection alone did not reliably replace old extension contexts in
the observed Edge session.

Version 1.0.6 adds a MutationObserver to sample response changes immediately,
with polling retained for completion and fallback. Ordered delivery is shared
between observer and polling samples. Observer cleanup is tested on cancellation.
This change still requires live verification before claiming incremental delivery.

Run the dedicated checker from a second terminal:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Test-GatewayStreaming.ps1
```

Reload extension 1.0.6 and refresh ChatGPT first. Once the checker starts, keep
ChatGPT in the foreground while it generates the answer. The checker reports
content update counts, revisions, completion, and timestamps, and writes
data/gateway-streaming-check.json. It distinguishes complete-answer delivery
from multiple intermediate updates rather than calling both streaming success.

The 1.0.6 live test produced one 2,024-character update. A subsequent read-only
trace found that a continued conversation's reader remained on that old answer
while the page already contained a newer response. Version 1.0.7 collects
candidate nodes across supported selectors and selects the newest by document
order, and adds the observed live-layout group body without requiring the
completed-turn wrapper. A DOM regression test covers an older legacy answer
followed by a growing current-layout answer. Live verification remains required.

Version 1.0.7 live verification PASSED: the dedicated fresh-chat test delivered
8 content updates totaling 2,113 characters, zero replacement events, and [DONE].
The saved measurement is data/gateway-streaming-check.json. This proves actual
incremental browser-text delivery on this user's current ChatGPT layout; it is
not an underlying model-token stream. The existing observer and polling share
the updated newest-response selection logic. After reload, always refresh the
ChatGPT tab before testing.

A subsequent request in the SAME conversation also PASSED: 4 content updates,
1,487 characters, [DONE], no error, and no You said/ChatGPT said transcript labels.
The result is data/gateway-followup-check.json. Both first and follow-up requests
were tested against the user's running gateway, not just a simulated extension.
Connection lifecycle logs are appended to data/gateway.log by the launcher.
Run the smoke test from a second terminal:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Test-Gateway.ps1
```

## Request contract

POST http://127.0.0.1:18790/v1/chat/completions with a JSON body:

```json
{"model":"auto","messages":[{"role":"user","content":"Ask one short interview question. Plain text only."}],"stream":true,"new_conversation":true,"timeout":180000}
```

With stream omitted or false, the existing complete JSON response is retained.
The browser extension still sends only the last user message. The simulator
must package its prompt/context there as described in voice-and-gateway-design.md.

With stream true, the response is text/event-stream:
- Unnamed data events contain chat.completion.chunk objects with content deltas.
- `event: snapshot` carries a full replacement `content` string when the browser
  revises already emitted text. Replace the draft; do not append it. This is a
  gateway extension to the usual protocol; generic clients may ignore it.
- Success ends with a finish_reason of stop and data: [DONE].
- `event: error` carries error.message and closes the stream without [DONE].
  A partial answer must remain marked incomplete.
- SSE comments provide keepalives. They are not answer text.

This relays visible browser text, not the underlying model token stream. Content
is sampled every 250 ms; stable text plus disappearance of the stop control is
used for completion. Live behavior remains dependent on ChatGPT's DOM and must
be checked manually. Text updates must not be fed directly to TTS as fragments.

Only one turn is allowed; concurrent calls return HTTP 409. The simulator can
queue requests itself. Disconnecting the HTTP stream requests browser cancellation.
DELETE /v1/requests/{requestId} also cancels; requestId is the chunk id with its
chatcmpl- prefix removed. No new turn is accepted until cancellation is acknowledged.
If acknowledgement fails, the extension connection is closed after a grace period.

The local API has no authentication. It binds only to 127.0.0.1, does not enable
cross-origin browser HTTP access, and is intended for the local simulator backend.

## Verification

From vendor/chatgpt-gateway:

```powershell
node --test --test-timeout=5000 test/gateway.test.mjs test/tab-readiness.test.mjs test/response-reader.test.mjs
```

Tests use a simulated WebSocket extension, not a real ChatGPT account. They cover
early chunks, final completion, text revisions, duplicate updates, stale IDs,
non-streaming compatibility, busy responses, timeouts/cancellation acknowledgement,
disconnect errors, and invalid inputs. Real-browser completion and cancellation
are still required before this integration is considered finished.
