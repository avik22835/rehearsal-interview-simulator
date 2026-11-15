# Background streaming in Edge and Chrome

Extension 1.1.0 / protocol 4 adds background response delivery. The logged-in
ChatGPT tab and browser must remain open, but the tab can be hidden while the
candidate uses the simulator. Browser shutdown, a sleeping computer, sign-out,
or a forcibly frozen/discarded page are not an available model connection.

## What changed

- The extension worker drives timer wakeups during a turn, avoiding dependency
  on the ChatGPT page's throttled background timers. Only the selected page is
  temporarily protected against automatic tab discard; its setting is restored
  afterward.
- A passive observer receives assistant text from a cloned conversation SSE
  response or supported WebSocket messages. It is armed only for the current
  gateway turn and stops afterward. It does not read request bodies, cookies,
  authorization headers or credentials, and preserves the original response.
  DOM extraction remains a fallback.
- The API sends `Cache-Control: no-cache, no-transform` for SSE responses. This
  prevents the Next.js proxy from gzipping and buffering small content updates.
  A direct/proxied comparison reproduced the old buffering and confirmed the fix.
- Interview turns put the spoken question first, followed by the renderer-safe
  `INTERVIEW_FEEDBACK_JSON:` delimiter and feedback metadata. The app streams the
  question immediately and withholds metadata, including split delimiters. JSON
  envelopes from older chats are still understood. Known escape/code wrappers
  around metadata are removed before strict JSON and citation validation.
- Each new interview receives an independent session key and a fresh ChatGPT
  conversation, regardless of whether earlier interviews were ended. Resuming an
  older interview restores its own saved URL. Starting another interview during
  this page's active generation cancels/pauses the old work before submitting the
  new opening. Only pre-dispatch gateway-busy rejections can be retried safely.

## Use

Reload the unpacked ChatGPT Gateway extension in `edge://extensions` or
`chrome://extensions` after updating, then refresh ChatGPT once to install the
document-start observer. Select an interview in the simulator and leave ChatGPT
in the background. No debugger permission or browser-wide throttling flags are
required. Host permissions and account sign-in handling remain unchanged.

The live check was performed in **Edge**. The extension uses Chromium Manifest
V3 APIs shared by Chrome; Chrome has not been separately live-tested on this
computer. The existing Firefox manifest is not a verified background target.

## Evidence from 27 October 2026

- In a local mock comparison, the old proxy delivered every event together at
  approximately 0.39 seconds with `Content-Encoding: gzip`. With `no-transform`,
  separate updates arrived at approximately 0.27, 0.31, 0.36, 0.41 and 0.48 seconds.
- Edge interview A and interview B received different browser-chat URLs without
  ending A. Returning to A restored A's original URL. Both were saved paused.
- The successful final retry produced question updates at 4.015 and 4.093
  seconds, before completion at 10.406 seconds. These were real received updates,
  rather than artificial splitting of a completed answer.
- The observer recorded 12 hidden-page samples, 10 with response text available,
  including 4 where network text was available while generation was unfinished.
- A malformed model feedback reply was rejected; retry preserved the candidate
  answer and chat binding. Assessment citation validation was not relaxed.

Detailed local evidence is in `data/background-verification.json`. Automated
coverage includes suspended page timers, passive response cloning, assistant vs.
reasoning filtering, split metadata markers, model wrapper variations, and new
interviews before previous interviews end. Final checks: 26 app tests, 39 relay
tests, and the frontend production build/typecheck.
