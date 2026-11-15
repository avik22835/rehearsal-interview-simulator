# Interview Simulator

A personal interview practice workspace, being built in verified phases.
Full scope: DSA, project deep dive, system design, backend, AI/ML/LLM, and resume
interviews with local history, evidence-based feedback, and CPU-only voice.

Current build: Rehearsal v0.1 includes the responsive app, all six typed practice
modes, local SQLite session history, pause/resume, JSON export, provider settings,
offline demo questions, streamed model replies, transcript-grounded live feedback,
and final assessments. Each interview uses one saved ChatGPT chat. The coding
workspace includes folder-based notes, keyword search, generated problems, Monaco,
Docker execution, frozen submissions and source-linked assessment. Local CPU voice
adds editable English recording, sentence-based neural interviewer playback, and
opt-in hands-free listening with pause-based automatic send plus current code.
Real microphone/accent acceptance and later practical workspaces remain in progress.

Run the installed app:

The selected desktop-host feasibility checkpoint is now available:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Start-Desktop.ps1
```

See [Desktop checkpoint](docs/DESKTOP-CHECKPOINT.md). It hosts the app, ChatGPT and its built-in gateway
in one window. The simulator uses http://127.0.0.1:18791/v1; no browser extension
is required inside Electron. Keep the desktop app running for this connection.
The existing browser version can be launched separately:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Start-Studio.ps1
```

Open http://127.0.0.1:3000. Choose **Practice demo** to explore offline, or
**Your model** with the gateway and ChatGPT tab running.

- [Application setup, checks, data and limitations](docs/PHASE-1.md)
- [Saved ChatGPT conversations, live feedback and final reports](docs/conversation-and-feedback.md)
- [Background streaming in Edge and Chrome](docs/background-streaming.md)

- [Agreed project brief and current scope](PROJECT-BRIEF.md)
- [Build roadmap](docs/BUILD-PLAN.md)
- [Gateway setup and streaming protocol](docs/gateway-streaming.md)
- [Voice design](docs/voice-and-gateway-design.md)
- [Spoken interviewer prompt](prompts/interviewer-spoken.txt)

Launch the gateway from this folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Start-Gateway.ps1
```
