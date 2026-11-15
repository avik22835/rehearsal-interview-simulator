# Rehearsal: foundation build

This build adds the local interview application. All six modes support typed
conversation. Dedicated coding tools, source imports, speech, assessments and
progress analysis belong to the later phases in BUILD-PLAN.md.

## Run on this computer

Dependencies and the production frontend are already installed and built.
Open PowerShell in the project folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Start-Studio.ps1
```

Open http://127.0.0.1:3000. Select a mode, optionally add a topic, choose your
level and time target, then choose **Practice demo** or **Your model**.
Practice demo runs offline with deterministic questions and no assessment.

For ChatGPT, keep the existing gateway terminal running and the logged-in
ChatGPT tab visible. Settings should use ChatGPT browser gateway, base URL
`http://127.0.0.1:18790/v1`, model `auto`, and streaming enabled. The gateway
does not need an API credential. The session setup asks permission to send
that session's topic and conversation to the configured model.

Send a typed answer with the arrow button or Ctrl+Enter. Pause saves your place;
resume from recent practice or history. Interrupted replies can be retried.
End session opens the Report tab and generates a transcript-grounded assessment. Live feedback appears in Feedback after each completed model turn. Demo sessions remain unscored.
Export downloads the session, messages and event history as JSON.

Stop the application separately from the gateway:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Stop-Studio.ps1
```

## Fresh setup or rebuilding

Use Python 3.12 and Node.js 22 or later with pnpm. From the project root:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r apps\api\requirements-lock.txt
Push-Location apps\web
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
Pop-Location
powershell -ExecutionPolicy Bypass -File .\scripts\Start-Studio.ps1
```

The launcher uses the Codex bundled Node when present, otherwise Node on PATH.
It starts hidden services, reuses healthy services, records process identities,
and checks readiness. After changing API code, restart the app. After frontend
changes, stop it, run `pnpm build` in apps/web, and start it again. For development,
pass `-Dev` to Start-Studio.ps1 after stopping the production app.

## Data and connections

- SQLite database: `data/simulator.db`; schema migration version 2.
- API: `http://127.0.0.1:8000`; frontend: `http://127.0.0.1:3000`.
- Service logs: `data/api-out.log`, `data/api-error.log`, `data/web-out.log`,
  `data/web-error.log`. Gateway diagnostics remain in `data/gateway.log`.
- The data folder, dependencies, local secrets and build outputs are Git-ignored.
- Optional compatible-endpoint credentials use Windows user DPAPI encryption.
  `SIMULATOR_API_KEY` can supply a process environment credential instead.
- Sessions record their provider and consent. Connection checks report optional
  capabilities as unverified until tested. Changing provider settings does not
  silently move an existing session to another provider.
- Each interview starts one ChatGPT conversation and saves its URL. Follow-ups
  send only the new answer and task to that same chat; final reports use it too.
  The first turn supplies the instructions once. See conversation-and-feedback.md
  for binding recovery and the one-time upgrade of older interviews.
- The web proxy allows the API's configured model timeout to finish. A truncated
  stream is an error; partial text remains saved and is never called complete.

## Verification

```powershell
$env:PYTHONPATH = Join-Path $PWD 'apps\api'
.\.venv\Scripts\python.exe -m pytest apps\api\tests -q
Push-Location apps\web
pnpm typecheck
pnpm build
Pop-Location
```

Twenty-six automated app tests cover all mode openings, contextual follow-ups, persistence,
state guards, pause/resume/end/export, partial failure and retry, startup recovery,
explicit remote consent, origin restrictions, Windows credential masking,
gateway context packing, Unicode and revised stream text, truncated streams,
and compatible non-streaming responses.

The browser mock flow was verified through start, answer, pause, reload, resume,
end and recap. Start/stop was verified using Windows PowerShell with this
workspace's Korean directory path. Narrow-screen layout was checked at 390px.

Live ChatGPT verification on 27 October 2026 passed: an opening question arrived
in two incremental updates and completed after more than 30 seconds; the next
question explicitly referenced the candidate's recall/precision answer. Pausing
another active request preserved both candidate answers and marked the unfinished
reply interrupted. After page reload, resume and retry produced a complete,
contextual oracle-context question without duplicating either answer. Ending
the session saved phase `report`, status `ended`, and two candidate answers.

One relay limitation was observed: cancellation acknowledgement timed out, so
the gateway reset and reconnected the extension automatically. The next request
succeeded without an extension reload. Allow that reconnection to finish before
retrying; a fully closed/disconnected ChatGPT-tab scenario still needs explicit
coverage during the voice/recovery phase. Keep ChatGPT visible for dependable
browser-backed streaming.

## What comes next

Phase 2 adds the coding workspace: preserved problem text, editor, isolated
Docker Python execution, tests and code snapshots. Phase 3 adds CPU-only speech.
Later phases add source-grounded workflows, artifact-based scoring and cross-session progress. Transcript-based live feedback and final reports are now implemented.
The current library screen explicitly identifies source imports as future work.


## Conversation and feedback update

Extension 1.0.8 adds one durable browser-chat binding per interview. The live
continuity check passed on 27 October 2026: opening retry, two candidate answers,
two validated live feedback records, and one complete five-dimension final report
all used the same ChatGPT URL. Each question arrived in two content updates.
Evidence is saved in data/continuity-verification.json. The final app and provider
suite has 20 passing tests; the gateway suite has 36. Typecheck and build pass.

The report can be cancelled from another app tab after reopening a session.
In-progress messages and reports refresh when reopened. The earlier cancellation
acknowledgement issue was addressed in extension 1.0.8 by acknowledging browser
cancellation directly instead of trying to redeliver a cancelled final response.
A fully closed ChatGPT-tab recovery scenario still needs explicit live coverage.

The gateway was restarted in the background during this update. Its current
logs are data/gateway-service.log and data/gateway-service-error.log. Starting
it later with Start-Gateway.ps1 uses data/gateway.log as before.

## Edge background-streaming update

Extension 1.1.0 is live-verified with the ChatGPT page hidden. The simulator
streams spoken question text before feedback generation completes, and the
proxy no longer buffers SSE through gzip. Earlier instructions to keep ChatGPT
visible are superseded: keep the browser and signed-in tab open in the background.
See background-streaming.md. Current checks: 26 app tests, 39 gateway tests and
the production frontend build/typecheck pass.
