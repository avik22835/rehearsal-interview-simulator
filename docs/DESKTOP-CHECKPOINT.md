# Desktop host checkpoint

28 October 2026. The desktop host and initial provider transport are implemented and live-tested.
Long-idle, tool-use, crash and packaging checks remain separate gates.

## Implemented

- Electron 45.1.0 hosts the existing simulator and a separate ChatGPT
  WebContentsView in one native window.
- The ChatGPT browser profile persists across launches and is independent of Edge.
  No Edge cookies or credentials are imported.
- Background throttling is disabled for ChatGPT. Lifecycle telemetry records
  page timer gaps, hidden/focus state, window minimize/restore and renderer memory.
- Native Workspace controls select the combined view, interview-only view, or
  ChatGPT-only view for sign-in. Verification controls show health and diagnostics.
- Remote content has sandboxing, context isolation and no Node integration.
  Navigation is restricted to ChatGPT/OpenAI and identified sign-in providers;
  runtime permission requests are denied at this checkpoint.
- Telemetry accepts a bounded schema from the hosted main frame. It does not
  capture passwords, cookies, prompts, response text or authentication URL queries.

**The simulator is configured for the desktop gateway at http://127.0.0.1:18791/v1.**
The gateway server runs inside Electron's main process and its built-in adapter
controls the hosted ChatGPT view. No Chrome/Edge extension is installed or required
inside Electron. The adapter reuses the existing content/response readers through
an isolated generated preload. The original Edge gateway remains separate on
port 18790; it is not used by the current simulator configuration.

Closing Electron stops its desktop gateway. Reopening Start-Desktop.ps1 starts
it again, along with any missing web/API services. The launcher checks that the
desktop gateway connects before reporting readiness.

## Launch

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Start-Desktop.ps1
```

The launcher starts missing web/API services, then opens the interactive desktop
host. Closing the desktop host leaves the shared web/API services running.
Use scripts/Stop-Studio.ps1 to stop registered app services when no longer needed.
Re-launching the desktop host brings its existing window forward.
The previous provider configuration is saved locally in data/provider-before-desktop.json.

If installing dependencies on another checkout, use Node 22.12 or newer and pnpm:

```powershell
Set-Location apps/desktop
pnpm install --frozen-lockfile
pnpm run install-runtime
pnpm test
```

Electron 45 downloads its runtime through the explicit install-runtime command.
The current machine already has that pinned runtime installed.

## Controls

- Ctrl+Shift+1: simulator and ChatGPT side by side.
- Ctrl+Shift+2: simulator only; the separate ChatGPT view remains managed.
- Ctrl+Shift+3: ChatGPT only / sign-in.
- Workspace menu: reload either page independently.
- Verification menu: inspect lifecycle health or open the local diagnostics folder.

An input composer is not proof of authentication: ChatGPT can display one while
signed out. Sign-in must be confirmed manually before persistence tests. Complete
authentication in the hosted page; never paste credentials into the simulator
or this chat. If an embedded login flow is blocked, preserve the error and report
the blocker. Do not spoof the browser or bypass account challenges.

## Local data

The prototype browser profile is data/desktop-profile; it contains private browser
session data. Diagnostics are data/desktop-host-health.json and
data/desktop-host-events.jsonl. The entire data directory is Git-ignored. Do not
publish it. This workspace is inside OneDrive: the prototype profile follows that
folder's sync configuration. Before packaging, move new-profile creation to the
Windows per-user application-data location and provide an explicit data policy.
Do not manually copy session cookies as a migration mechanism.

## Verification record and remaining gates

Five automated checks pass: canonical conversation binding, allowed navigation/deceptive-host rejection, redacted
URL logging, split/focused layout bounds, and telemetry schema rejection. Main
and preload JavaScript syntax checks pass.

Live verification on 28 October 2026:

- The user signed in within the desktop host. Sign-in survived a clean host restart.
- A minimized transport check returned four incremental updates and completed in
  11.75 seconds. The window stayed minimized and the page reported hidden=false.
- Two full interviews received different chat URLs. Two consecutive follow-ups,
  two validated live feedback records and a validated final report stayed in the
  first interview's chat while the host remained minimized. The second follow-up
  began streaming at 4.641 seconds and completed at 8.75 seconds; the report
  completed at 15 seconds. These observations are not latency guarantees.
- Cancelling after the first streamed text, then immediately starting another
  interview, succeeded with zero pending requests. Cancellation took 0.062 seconds.
- With the ChatGPT panel hidden in interview-only mode, a separate test returned
  three updates and completed in 10.203 seconds without opening that panel.
- The API connection check identifies the desktop adapter, rather than instructing
  the user to reload the Edge extension.

Evidence is local and ignored by Git: data/desktop-streaming-verification.json,
data/desktop-interview-verification.json, data/desktop-cancellation-verification.json,
and data/desktop-collapsed-verification.json. The existing API suite (31 tests),
shared gateway suite (41 tests), five desktop checks and JavaScript syntax checks pass.

Still required:

1. Long-idle/repeated startup, renderer crash and disconnect recovery coverage.
2. Tool-assisted replies and generated artifact handling in the desktop host.
3. Independent mode coverage beyond these synthetic backend interviews.
4. Complete installer/service shutdown ownership and profile storage hardening.
5. Wider performance measurements alongside Docker and future CPU voice workers.

The signed-out narrow ChatGPT view can use a mobile composer. The current live
checks used the signed-in rich composer; do not assume signed-out operation is
supported by the adapter.
