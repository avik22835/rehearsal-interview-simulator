# Local interview voice

Updated 1 November 2026. Local English transcription and sentence playback now
support both manual recording and opt-in hands-free turn taking. Continuous partial
transcription and automatic interruption during interviewer playback remain open.
Physical microphone/acoustic acceptance of the automatic loop still needs the user.

## Flow

Record answer → Stop → review/edit transcript → Send answer → existing interviewer
turn path → stable spoken sentences → local neural voice. Current coding draft,
selected problem and run freshness are captured through the same central path as
typed answers. Voice does not create separate ChatGPT conversations or send each
keystroke. All six modes share the voice bar.

## Hands-free conversation

Enable **Hands-free** once in an interview. This also enables spoken replies.
Start the interview normally; after the entire question has played, a 350 ms
settling delay precedes automatic microphone capture. The end-of-question marker
allows listening while feedback metadata is still arriving. Older JSON-only
responses without this signal fall back to transport completion.
It does not listen between streamed sentences or while output audio is playing.
Enabling it after a completed question replays that question before listening.

The AudioWorklet measures audio activity using an adaptive amplitude threshold
and a sample-clock pause detector. At least 400 ms of activity arms the turn;
isolated short clicks do not accumulate across quiet gaps. Silence before any
activity never submits. After activity, the configured pause is 3 seconds by default,
with 2, 4.5 and 6 second alternatives. A countdown is visible. Resumed speech resets
the pause. **Hold — I’m thinking** suspends automatic send; releasing hold starts a
fresh pause interval. This is acoustic activity detection, not semantic endpoint
detection: room noise and microphone levels still need real-device testing.

On a completed pause the mic closes, local Whisper transcribes the recording, and
the nonempty text sends automatically through the existing turn callback. Sending
waits for an outstanding model request to finish, preserving serialization. The code
snapshot is taken at actual send time, including edits made while speaking. If a
coding operation is still busy, the transcript waits; editing/discarding it cancels
that automatic send. The raw recording is not sent to ChatGPT. The next completed
spoken model turn starts listening again without another Record or Send click.

**Stop & review** exits automatic mode for manual correction. Turning hands-free
off, interview pause/end, navigation, or a changed question cancels capture and
pending transcription. A late microphone permission result cannot reopen a
cancelled capture. Resume does not silently turn the microphone back on. Empty
transcripts, recognition/playback/permission errors stop automatic mode instead
of repeatedly sending or retrying. Initial silence times out after 30 seconds
unless thinking hold is active. The existing 90-second recording cap requires
manual review rather than automatically sending a cut-off answer.

Recognition uses faster-whisper 1.2.1, English base.en, CPU int8, two threads and
beam size 3. The user speaks English with a Hindi-native accent; measure his actual
microphone performance before making accuracy claims. Transcripts stay editable.
Whisper handles silence internally; no additional independent confidence cutoff
silently removes potentially accented words.

Default quick voice: Piper 1.8.0, Lessac medium. Optional expressive voices:
Kokoro ONNX 0.6.1 with the full-precision CPU model. Voice choice is saved locally;
spoken replies are opt-in for each opened interview. Speed, volume, stop and replay
are available. On this laptop the quantized Kokoro model and four CPU threads
were slower; do not assume quantization means faster.

## Runtime and privacy

- AudioWorklet captures mono audio; local downsampling produces 16 kHz PCM WAV.
- Recording is visible, stops at 90 seconds, and releases all microphone tracks.
- Recording stops current/queued playback. Stop audio suppresses the rest of that
  question and pauses hands-free. New turns, pause/end and navigation cancel stale
  playback/capture. Automatic send happens only in explicitly enabled hands-free.
- The API never saves recordings. The confirmed transcript enters the existing
  interview database/provider path on manual Send or an enabled hands-free pause.
  Sending shares transcript and
  current interview/code context with the selected model under existing consent.
- Models load from local paths only. Initial setup downloads official upstream
  assets; inference has no cloud fallback.
- Separate persistent spawned processes isolate STT and TTS from the API. Each
  permits one job and returns 409 for overlap. Cancelling a request does not free
  the slot until native inference finishes; stale results are discarded. Worker
  failures return an explicit error and recreate the process for the next request.
- Only selected TTS engine weights stay loaded. CPU concurrency is bounded.
- Electron allows audio capture only for the trusted local studio main frame.
  The separate ChatGPT session still denies microphone and camera permissions.

Only assistant interview messages drive speech. Feedback, reports, code and JSON
are excluded. The existing provider parser streams plain question text; TTS does
not wait for a report JSON payload. Stable sentence boundaries preserve decimals
and common abbreviations. Long sentences are bounded without dropping words.
Synthesis runs at most two clips ahead of playback. Pauses currently follow voice
punctuation/prosody; extra configurable paragraph pauses remain a refinement.

## Setup

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Setup-Voice.ps1
```

Models live outside OneDrive at `%LOCALAPPDATA%\Rehearsal\voice`;
`REHEARSAL_VOICE_DIR` overrides this. Setup pins Hugging Face model revisions and
records asset sizes/local SHA-256 fingerprints in models.json. Those hashes are
local integrity fingerprints, not upstream signatures. No interview downloads.

This machine's older Microsoft C++ system DLLs caused ONNX initialization failure.
Verified signed Microsoft copies were placed in the private speech/runtime folder
and are loaded only by speech workers. Windows system files were not modified.
Setup accepts `-RuntimeSource <folder>` for an existing verified Microsoft runtime
if this workaround is needed. Pronunciation data is copied out of the Unicode
OneDrive path because eSpeak's native file lookup failed there.

## Evidence and remaining acceptance

67 API tests passed, covering Docker and voice bounds/cancellation, plus native
worker crash recovery. The frontend
production build and speech boundary/PCM checks passed. An isolated Edge fake-
device test exercised actual AudioWorklet capture, transcript editing, send and
playback interruption. A delayed-metadata provider test confirmed speech was
requested about 1.8 seconds before model completion and never included JSON.
The coding regression sent a corrected voice transcript together with the current
unsaved editor snapshot and completed its Docker/submission/report flow.
An isolated Electron test accepted one audio track and
denied audio+video. Fake devices do not validate the user's actual microphone,
Windows privacy settings, accent or preferred voice quality.

Synthetic engine roundtrip passed with socket connections blocked inside the
benchmark. A separate real HTTP test used native subprocess workers and recognized
binary-search/Python and hash-map/collision questions. Two warm synthesis requests
took 602 and 559 ms; recognition took 3026 and 2151 ms for about 3.2 and 2.4 seconds
of synthetic audio. Longer answers and concurrent load will differ.

Kokoro full precision/two threads took about 6.2 seconds for a three-second test
sentence; it is an explicit slower option. These timings do not prove human voice
preference or pronunciation quality. Next gates: real accented technical answers,
user listening, longer interviews, cancellation and provider-disconnection recovery.
Continuous partial transcription and automatic echo-safe barge-in remain open.

Hands-free verification (1 November): a synthetic WAV microphone exercised the real
AudioWorklet and pause detector, with controlled recognition text. The browser test
verified automatic microphone start after playback, thinking hold, pause-based
send, current unsaved Monaco code attachment, automatic next-turn listening,
interview-pause cancellation, empty-transcript handling and no playback overlap.
Cancelling while a delayed transcription was in progress also prevented a stale
answer from being sent.
A separate streaming test deliberately delayed feedback JSON and verified that
the microphone opened after audio playback while that metadata was still pending
(data/handsfree-early-listening.json and data/handsfree-listening.png).
This does not establish real microphone/accent or noisy-room performance. Evidence:
data/handsfree-verification.json and data/handsfree-ui.png. Standalone pause tests
cover initial silence, isolated/repeated click noise, resumed speech and hold reset.

Ignored local evidence contains synthetic test material: data/voice-benchmark.json,
data/voice-http-verification.json, data/voice-comparison.log, data/voice-ui-dark.png
and data/voice-electron-out.log.

Provider/session design remains the managed Electron ChatGPT view on 18791; see
DESKTOP-ARCHITECTURE.md and conversation-and-feedback.md. The Edge extension on
18790 is a separate fallback, unrelated to local speech inference.

Sources and packaging references:
- https://github.com/SYSTRAN/faster-whisper
- https://github.com/thewh1teagle/kokoro-onnx
- https://huggingface.co/hexgrad/Kokoro-82M
- https://github.com/OHF-Voice/piper1-gpl (GPL engine; voice licenses are separate)
- https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/lessac/medium/MODEL_CARD
- https://onnxruntime.ai/docs/install/
- https://github.com/espeak-ng/espeak-ng/blob/master/src/include/espeak-ng/speak_lib.h
