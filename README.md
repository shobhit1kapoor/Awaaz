# AI Buddy Windows

Tauri 2 Windows port of Clicky. The original Swift source is copied into `clicky-reference/leanring-buddy/` and is the read-only behavior reference.

## Setup

```powershell
npm ci
Copy-Item .env.example .env
Push-Location worker
npm ci
Pop-Location
npm run tauri dev
```

Run the Worker in a second terminal with `cd worker; npm run dev`. Add `NVIDIA_API_KEY` and `ASSEMBLYAI_API_KEY` to the ignored `worker/.dev.vars` file to enable screenshot-aware chat and transcription. Voice replies use local Windows speech synthesis by default.

Explicit voice commands can open installed applications and folders in Desktop, Documents, Downloads, or OneDrive. Other computer-control actions remain disabled.

## Checks

```powershell
npm test
npm run build
cd src-tauri
cargo test
cargo clippy --all-targets -- -D warnings
```
