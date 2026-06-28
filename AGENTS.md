# AGENTS.md — AI Screen Buddy (Tauri 2 Windows Port of Clicky)

> **READ THIS ENTIRE FILE BEFORE TOUCHING ANY CODE.**
> This is the operating manual for every AI coding agent working on this project.
> Works with: Claude Code, Codex CLI, Cursor, Windsurf, GitHub Copilot, Gemini CLI.

---

## Your Mission

You are porting **Clicky** (https://github.com/farzaa/clicky) from macOS (Swift/SwiftUI/AppKit)
to **Windows** using **Tauri 2** (Rust backend + React + TypeScript frontend).

The original Clicky repo is included in this project at `./clicky-reference/` — you can and
SHOULD read the Swift source files there to understand exactly how every feature works before
implementing the Tauri equivalent. The Swift code is the ground truth for behavior.

**This is a faithful port, not a redesign.** Match the UX exactly. Same pipeline, same feel,
same [POINT] system. Replace macOS-only APIs with Windows equivalents. Do not invent new features.

### Current Windows core architecture

- The always-running `overlay` webview owns the voice pipeline through `useVoiceController.ts`.
- The global shortcut and panel button emit the same push-to-talk events. `useAppStateBridge.ts`
  mirrors overlay state into the panel.
- `capture_screen` uses `windows-capture` to grab the monitor containing the cursor, includes the
  cursor and physical monitor metadata, resizes to at most 1280px wide, and returns JPEG quality 75.
- The overlay is sized to the complete Windows virtual desktop and the blue dot follows the physical
  cursor through `useCursorPosition.ts`.
- `VITE_TTS_MODE=local` is the runnable default and queues Windows/WebView speech synthesis.
  Worker TTS remains optional and requires a verified `NVIDIA_TTS_MODEL`.
- The Worker exposes `GET /health`, NVIDIA chat, AssemblyAI pre-recorded transcription, optional
  TTS, and the AssemblyAI streaming-token route. Provider keys remain Worker secrets.
- `commands/action.rs` exposes only `open_app` and `open_folder`. Targets are resolved from Windows
  app aliases, Start Menu shortcuts, and standard user folders; arbitrary shell commands are never
  accepted. `actionParser.ts` handles model tags and deterministic explicit voice-command fallback.

---

## How to Read the Swift Source (Reference Files)

The original Swift files are in `./clicky-reference/leanring-buddy/`. Read them like this:

| If you need to understand... | Read this Swift file first |
|------------------------------|---------------------------|
| The overall state machine and pipeline | `CompanionManager.swift` (~1026 lines) |
| The push-to-talk hotkey + mic capture | `BuddyDictationManager.swift` (~866 lines) |
| The cursor overlay window | `OverlayWindow.swift` (~881 lines) |
| How [POINT:x,y:label:screenN] tags are parsed and animated | `OverlayWindow.swift` — look for `parseAndAnimatePoints()` |
| Claude SSE streaming client | `ClaudeAPI.swift` (~291 lines) |
| AssemblyAI WebSocket streaming | `AssemblyAIStreamingTranscriptionProvider.swift` (~478 lines) |
| ElevenLabs TTS playback | `ElevenLabsTTSClient.swift` (~81 lines) |
| Screen capture (multi-monitor) | `CompanionScreenCaptureUtility.swift` (~132 lines) |
| The system tray / menu bar panel | `MenuBarPanelManager.swift` (~243 lines) |
| The panel UI (controls, settings) | `CompanionPanelView.swift` (~761 lines) |
| The Cloudflare Worker API | `worker/src/index.ts` (~142 lines) |

**You do not need to write Swift. You need to understand the logic and re-implement it in
Rust + TypeScript.** Read the Swift, understand what it does, then write the equivalent.

---

## Architecture Overview

### macOS Original → Tauri 2 Windows Mapping

| macOS (Swift) | Windows Tauri 2 Equivalent | Notes |
|---------------|---------------------------|-------|
| `NSStatusItem` (system tray) | `tauri-plugin-tray` | System tray icon + right-click menu |
| `NSPanel` (floating panel) | Tauri `WebviewWindow` with `decorations: false` | The companion control panel |
| Full-screen transparent `NSPanel` (overlay) | Tauri `WebviewWindow` transparent + `always_on_top` | The blue cursor overlay |
| `AVAudioEngine` (mic capture) | WASAPI via `cpal` Rust crate or `getUserMedia` in JS | PCM16 16kHz mono audio |
| `ScreenCaptureKit` (screenshots) | `windows-capture` Rust crate or WinRT `GraphicsCaptureItem` | Multi-monitor aware |
| `CGEvent` tap (global hotkey) | `tauri-plugin-global-shortcut` | Ctrl+Shift+Space default |
| `AVAudioPlayer` (audio playback) | Rust `rodio` crate streaming MP3 chunks | Stream, do not buffer |
| `NSHostingView` + SwiftUI | React components in Tauri webview | All UI is React/TSX |
| `@MainActor` + async/await | Rust async + `tauri::command` invoke | State sync via events |
| `PostHog analytics` | PostHog JS SDK (optional, add later) | Skip for v1 |

### Two-Window Architecture (Critical — Get This Right)

Clicky runs as **two separate windows simultaneously**. This is the core UX.

**Window 1: `panel`** (the control panel)
- Triggered by clicking the tray icon
- Appears near the tray icon, like a dropdown
- Contains: push-to-talk button, conversation history, model picker, settings link
- NOT always-on-top — it dismisses when user clicks outside
- Width: ~380px, height: ~560px, no decorations, rounded corners
- Closes (hides, not destroys) when user clicks outside

**Window 2: `overlay`** (the cursor overlay)
- Always exists, full-screen, always-on-top
- Completely transparent background — only the blue dot + response text are visible
- Click-through: mouse events pass THROUGH it to windows beneath
- This is where the blue cursor buddy lives
- This is where [POINT] animations happen
- This is where response text floats near the cursor
- This is where the audio waveform renders during recording
- Never closes — just shows/hides elements on it

### Full Pipeline (Exactly Like Original)

```
USER HOLDS HOTKEY (Ctrl+Shift+Space)
    │
    ▼
[Tauri Rust] register_global_shortcut fires "hotkey-pressed" event
    │
    ▼
[React overlay] waveform animation starts, recording starts
    │
    ▼
[JS] getUserMedia({ audio: true }) → MediaRecorder → WebSocket
    │
    ▼
[Deepgram or AssemblyAI] Streaming WebSocket → interim transcripts displayed live
    │
USER RELEASES HOTKEY
    │
    ▼
[Deepgram] sends final transcript → WebSocket closes
    │
    ▼
[Tauri Rust] invoke("capture_screen") → base64 JPEG of screen with cursor on it
    │
    ▼
[JS] POST to Worker /chat with { screenshot_base64, transcript, conversation_history }
    │
    ▼
[Cloudflare Worker] → Anthropic Claude SSE stream (model: claude-haiku-4-5 default)
    │
    ▼
[JS] SSE stream → tokens render in overlay in real time
    │        └─→ parse [POINT:x,y:label:screenN] tags as they stream
    │        └─→ on sentence boundary → POST to Worker /tts → stream audio → play
    │
    ▼
[React overlay] animate blue dot to [POINT] coordinates via bezier arc
    │
    ▼
[Rust] invoke("move_cursor_to", { x, y }) to physically move system cursor (optional)
```

---

## Project Structure (Build This)

```
ai-buddy-windows/
│
├── AGENTS.md                        ← this file
├── clicky-reference/                ← READ-ONLY: original Swift source for reference
│   └── leanring-buddy/              ← all Swift files here
│       ├── CompanionManager.swift
│       ├── OverlayWindow.swift
│       ├── ClaudeAPI.swift
│       └── ... (all other Swift files)
│
├── src/                             ← React + TypeScript frontend
│   ├── windows/
│   │   ├── overlay/                 ← full-screen transparent overlay
│   │   │   ├── Overlay.tsx          ← root component for overlay window
│   │   │   ├── BlueCursor.tsx       ← the blue dot companion (animated)
│   │   │   ├── ResponseBubble.tsx   ← floating text next to the cursor
│   │   │   ├── AudioWaveform.tsx    ← 5-bar waveform during recording
│   │   │   └── PointerAnimation.tsx ← bezier arc animation to [POINT] targets
│   │   └── panel/                   ← companion control panel
│   │       ├── Panel.tsx            ← root component for panel window
│   │       ├── ConversationHistory.tsx
│   │       ├── PushToTalkButton.tsx
│   │       ├── ModelPicker.tsx      ← Haiku / Sonnet / Opus selector
│   │       └── SettingsPanel.tsx
│   ├── hooks/
│   │   ├── useMicrophone.ts         ← getUserMedia, MediaRecorder, audio level
│   │   ├── useDeepgramStream.ts     ← WebSocket STT, interim + final transcript
│   │   ├── useClaudeSSE.ts          ← SSE stream from Worker /chat
│   │   ├── useTTSPlayer.ts          ← stream audio from Worker /tts, play chunks
│   │   └── usePointParser.ts        ← parse [POINT:x,y:label:screenN] from text
│   ├── lib/
│   │   ├── workerClient.ts          ← all HTTP calls to Cloudflare Worker
│   │   ├── pointParser.ts           ← regex + coord parser for [POINT] tags
│   │   ├── sentenceDetector.ts      ← detect sentence boundaries for TTS chunking
│   │   └── audioLevel.ts           ← RMS level from mic buffer for waveform
│   ├── store/
│   │   └── appStore.ts              ← Zustand: voice state, conversation, settings
│   ├── overlay.tsx                  ← entry point for overlay window
│   ├── panel.tsx                    ← entry point for panel window
│   └── vite.config.ts
│
├── src-tauri/                       ← Rust Tauri backend
│   ├── src/
│   │   ├── main.rs                  ← Tauri entry, thin: just calls lib.rs setup
│   │   ├── lib.rs                   ← app builder: plugins, windows, command registration
│   │   ├── commands/
│   │   │   ├── screen.rs            ← capture_screen() → base64 JPEG
│   │   │   ├── cursor.rs            ← get_cursor_pos(), move_cursor_to(x,y,ms)
│   │   │   ├── window.rs            ← setup_overlay_window(), click_through()
│   │   │   └── monitor.rs           ← list_monitors() → [{id, x, y, w, h, scale}]
│   │   └── tray.rs                  ← system tray icon + menu
│   ├── Cargo.toml
│   ├── tauri.conf.json              ← window definitions (see below)
│   └── capabilities/
│       └── default.json             ← Tauri 2 capability grants
│
├── worker/                          ← Cloudflare Worker (same as original Clicky)
│   ├── src/
│   │   └── index.ts                 ← /chat, /tts, /transcribe-token routes
│   ├── wrangler.toml
│   └── package.json
│
├── .env.example                     ← VITE_WORKER_URL=https://your-worker.workers.dev
└── package.json
```

---

## Tauri 2 Window Configuration

This is the most critical config. Get it wrong and the whole UX breaks.

### `tauri.conf.json` windows section:

```json
{
  "app": {
    "windows": [
      {
        "label": "overlay",
        "url": "overlay.html",
        "title": "AI Buddy Overlay",
        "width": 1920,
        "height": 1080,
        "x": 0,
        "y": 0,
        "transparent": true,
        "decorations": false,
        "alwaysOnTop": true,
        "skipTaskbar": true,
        "resizable": false,
        "focus": false,
        "visible": true,
        "fullscreen": false
      },
      {
        "label": "panel",
        "url": "panel.html",
        "title": "AI Buddy",
        "width": 380,
        "height": 560,
        "decorations": false,
        "transparent": true,
        "alwaysOnTop": false,
        "skipTaskbar": true,
        "resizable": false,
        "visible": false
      }
    ]
  }
}
```

### Making the overlay click-through (Windows-specific)

The overlay window MUST pass mouse events through to the windows below it. Do this in Rust:

```rust
// src-tauri/src/commands/window.rs
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowLongPtrW, GetWindowLongPtrW, GWL_EXSTYLE,
    WS_EX_TRANSPARENT, WS_EX_LAYERED, WS_EX_TOOLWINDOW
};

#[tauri::command]
pub fn make_overlay_click_through(window: tauri::WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(
            hwnd,
            GWL_EXSTYLE,
            style | WS_EX_TRANSPARENT.0 as isize
                  | WS_EX_LAYERED.0 as isize
                  | WS_EX_TOOLWINDOW.0 as isize
        );
    }
    Ok(())
}
```

Call this once when the overlay window is created. `WS_EX_TRANSPARENT` makes mouse events pass through. `WS_EX_TOOLWINDOW` hides it from Alt+Tab.

---

## Rust Commands (src-tauri/src/commands/)

These are the Tauri commands JS calls via `invoke()`. Keep Rust commands THIN — no business logic here. Logic goes in TypeScript.

### `screen.rs`

```rust
use base64::Engine;
use image::{ImageFormat, DynamicImage};

#[tauri::command]
pub async fn capture_screen() -> Result<String, String> {
    // Use `windows-capture` crate for WinRT-based capture
    // Returns base64-encoded JPEG at 75% quality, max 1280px wide
    // MUST capture the monitor that the cursor is currently on — same as original
    // Include cursor position metadata: { base64: String, cursor_x: i32, cursor_y: i32, monitor_id: u32 }
    // Implemented: first-frame capture, JPEG quality 75, max width 1280,
    // plus cursor, monitor bounds, and encoded-image metadata.
}
```

**Reference:** Read `CompanionScreenCaptureUtility.swift` — it captures the screen the cursor
is on, resizes if needed, and returns PNG. We use JPEG 75% quality instead to save tokens.

### `cursor.rs`

```rust
use windows::Win32::UI::Input::KeyboardAndMouse::SetCursorPos;
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

#[tauri::command]
pub fn get_cursor_pos() -> Result<(i32, i32), String> {
    // Returns current cursor position in screen coordinates (DPI-aware)
    // Implemented with GetCursorPos.
}

#[tauri::command]
pub async fn move_cursor_to(x: i32, y: i32, duration_ms: u64) -> Result<(), String> {
    // Animate cursor from current pos to (x, y) over duration_ms
    // Use ease-in-out cubic interpolation — same feel as original bezier arc
    // 60 steps minimum for smooth animation
    // IMPORTANT: This moves the REAL system cursor, not just the overlay dot
    // The overlay dot follows via a separate React animation
    // Implemented with eased SetCursorPos steps.
}
```

**Reference:** `OverlayWindow.swift` — look at the bezier arc animation. We do both:
move the real cursor (Rust) AND animate the overlay dot (React) simultaneously.

### `monitor.rs`

```rust
#[derive(serde::Serialize)]
pub struct MonitorInfo {
    pub id: u32,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub is_primary: bool,
}

#[tauri::command]
pub fn list_monitors() -> Result<Vec<MonitorInfo>, String> {
    // Return all connected monitors with their position, size, and DPI scale
    // Required for multi-monitor [POINT] coordinate mapping
    // Implemented through Tauri monitor enumeration.
}
```

**Reference:** `CompanionScreenCaptureUtility.swift` — it handles multi-monitor with screenN index.

---

## The [POINT] System (Most Critical Feature)

This is the signature feature of Clicky. Get it exactly right.

### Tag format

Claude embeds this in its response text:
```
[POINT:450:320:label:screen0]
```
- `450` = x coordinate in screen pixels
- `320` = y coordinate in screen pixels  
- `label` = short text shown near the pointer (e.g. "Click here")
- `screen0` = monitor index (screen0 = primary, screen1 = secondary, etc.)

### Parser (`src/lib/pointParser.ts`)

```typescript
export interface PointTag {
  x: number;
  y: number;
  label: string;
  screenIndex: number;
  rawTag: string;       // the full [POINT:...] string to strip from display text
}

const POINT_REGEX = /\[POINT:(\d+):(\d+):([^:\]]+):screen(\d+)\]/g;

export function parsePointTags(text: string): {
  cleanText: string;
  points: PointTag[];
} {
  const points: PointTag[] = [];
  let cleanText = text;

  for (const match of text.matchAll(POINT_REGEX)) {
    points.push({
      x: parseInt(match[1]),
      y: parseInt(match[2]),
      label: match[3],
      screenIndex: parseInt(match[4]),
      rawTag: match[0],
    });
    cleanText = cleanText.replace(match[0], '');
  }

  return { cleanText: cleanText.trim(), points };
}
```

**Reference:** `OverlayWindow.swift` — look for the function that parses and animates points.
The original uses bezier arcs. Replicate the smooth curved flight path.

### Coordinate mapping for multi-monitor

```typescript
// When screenN is received, map (x,y) to absolute screen coordinates
// using the monitor list from list_monitors() Rust command
async function mapToAbsoluteCoords(
  x: number, y: number, screenIndex: number,
  monitors: MonitorInfo[]
): Promise<{ absX: number; absY: number }> {
  const monitor = monitors[screenIndex] ?? monitors[0];
  return {
    absX: monitor.x + Math.round(x * monitor.scaleFactor),
    absY: monitor.y + Math.round(y * monitor.scaleFactor),
  };
}
```

### Animation (React `PointerAnimation.tsx`)

The blue dot FLIES to the [POINT] coordinates using a bezier arc — not a straight line.
Replicate this from `OverlayWindow.swift` (`animateCursorToBezier` function):
- Duration: 400–600ms
- Curve: ease-in-out cubic
- The arc lifts slightly off the straight path (add a midpoint offset of ~80px upward)
- After arrival: show a pulse ring animation + the label text for 2 seconds
- Then: return the cursor to its resting position near the real cursor

---

## Voice State Machine

Mirror `CompanionManager.swift` exactly. These are the states:

```typescript
// src/store/appStore.ts
type VoiceState =
  | 'idle'          // waiting for hotkey, blue dot follows cursor passively
  | 'listening'     // hotkey held, mic active, waveform showing, STT streaming
  | 'processing'    // hotkey released, waiting for Claude first token
  | 'responding';   // Claude SSE streaming + TTS playing

// State transitions:
// idle → listening   : hotkey pressed
// listening → processing : hotkey released + STT final transcript received
// processing → responding : first Claude SSE token received
// responding → idle  : TTS playback complete AND SSE stream closed
```

The overlay shows different content per state:
- `idle`: small blue dot following cursor, no text
- `listening`: blue dot + audio waveform (5 animated bars) + "Listening..." text
- `processing`: blue dot + spinner
- `responding`: blue dot + response text bubble streaming in + TTS audio playing

---

## STT: Deepgram Integration (`src/hooks/useDeepgramStream.ts`)

We use Deepgram Nova-3 instead of AssemblyAI (cheaper, faster, same WebSocket protocol).

**Reference:** `AssemblyAIStreamingTranscriptionProvider.swift` — same concept, different WebSocket URL.

```typescript
// Get a short-lived token from the Worker first
const { token } = await fetch(`${WORKER_URL}/transcribe-token`).then(r => r.json());

// Open WebSocket with the token
const ws = new WebSocket(
  `wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=1&interim_results=true`,
  ['token', token]
);

// CRITICAL from Swift original: use a single long-lived WebSocket connection
// Do NOT create a new WebSocket per push-to-talk session
// Just send/stop audio on the existing connection
// See: AssemblyAIStreamingTranscriptionProvider.swift shared URLSession pattern

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'Results') {
    const transcript = data.channel.alternatives[0].transcript;
    const isFinal = data.is_final;
    if (isFinal && transcript) {
      onFinalTranscript(transcript); // triggers Claude call
    } else if (transcript) {
      onInterimTranscript(transcript); // display live in overlay
    }
  }
};
```

**Worker route to add (`worker/src/index.ts`):**

```typescript
// GET /transcribe-token → returns short-lived Deepgram token
// Same pattern as original AssemblyAI token endpoint
if (url.pathname === '/transcribe-token') {
  const res = await fetch('https://api.deepgram.com/v1/projects/{PROJECT_ID}/keys', {
    method: 'POST',
    headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment: 'session-token', scopes: ['usage:write'], time_to_live_in_seconds: 480 }),
  });
  return Response.json(await res.json());
}
```

---

## Claude SSE Integration (`src/hooks/useClaudeSSE.ts`)

**Reference:** `ClaudeAPI.swift` — specifically the SSE streaming mode.

```typescript
// POST to Worker /chat — same request shape as original
const response = await fetch(`${WORKER_URL}/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: selectedModel, // 'claude-haiku-4-5' | 'claude-sonnet-4-6' | 'claude-opus-4-6'
    max_tokens: 512,
    stream: true,
    system: SYSTEM_PROMPT,  // see below
    messages: [
      ...conversationHistory,
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: screenshotBase64 }
          },
          { type: 'text', text: transcript }
        ]
      }
    ]
  })
});

// Parse SSE: look for "data: {...}" lines, extract content_block_delta → text_delta
const reader = response.body!.getReader();
// ... standard SSE parsing loop
// On each text chunk: append to display, run through parsePointTags(), chunk TTS
```

### System Prompt (match original behavior)

```typescript
const SYSTEM_PROMPT = `You are an AI buddy that lives next to the user's cursor.
You can see their screen. Be extremely concise — 1 to 3 sentences max unless they explicitly ask for more.
Speak directly to the user as a helpful friend, not an assistant.

When you reference something on screen that has a specific location, include a POINT tag immediately after mentioning it:
[POINT:x:y:short_label:screen0]

x and y are pixel coordinates of the element on screen0 (primary monitor).
Only use POINT tags when you're referencing something clearly visible and locatable on screen.
Never include POINT tags for abstract concepts.
Never explain what you're doing or that you're an AI. Just help.`;
```

---

## TTS Integration (`src/hooks/useTTSPlayer.ts`)

**Reference:** `ElevenLabsTTSClient.swift` — sends text, receives audio stream, plays it.

```typescript
// Stream audio CHUNK BY CHUNK — do not buffer the whole response
// Start playing as soon as the first audio chunk arrives

async function playTTS(sentence: string): Promise<void> {
  const response = await fetch(`${WORKER_URL}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: sentence, voice: 'nova', model: 'tts-1' })
  });

  // Use Web Audio API to play streaming MP3
  const audioCtx = new AudioContext();
  const reader = response.body!.getReader();
  // ... decode chunks with audioCtx.decodeAudioData, queue them
}

// CRITICAL: detect sentence boundaries BEFORE the full response is done
// Start TTS on first complete sentence (.?! followed by space or end)
// This is how the original gets the fast response feel
function detectSentenceBoundary(text: string): string | null {
  const match = text.match(/^(.+?[.!?])(\s|$)/);
  return match ? match[1] : null;
}
```

---

## Cloudflare Worker (`worker/src/index.ts`)

This is the same as the original. Keep it. Just add the Deepgram token route.

```typescript
// Routes:
// GET  /health      → non-secret provider readiness
// POST /chat        → NVIDIA OpenAI-compatible chat (SSE proxy)
// POST /transcribe  → AssemblyAI upload + Universal-3 Pro transcription
// POST /tts         → optional configured cloud TTS
// POST /transcribe-token → AssemblyAI short-lived streaming token

// Secrets (wrangler secret put):
// ANTHROPIC_API_KEY
// OPENAI_API_KEY
// DEEPGRAM_API_KEY

// DO NOT put these in wrangler.toml — secrets only
```

---

## System Tray (`src-tauri/src/tray.rs`)

```rust
// System tray icon behavior (mirrors NSStatusItem in original)
// Left-click → toggle panel window (show if hidden, hide if visible)
// Right-click → context menu:
//   [ ] Show Clicky  (toggle overlay visibility)
//   ─────────────
//   Settings
//   ─────────────
//   Quit

// The tray icon should change based on voice state:
// idle → normal icon
// listening → animated icon (or different icon)
// processing/responding → spinner icon
```

---

## Cargo.toml Dependencies

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon", "image-png"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
base64 = "0.22"
image = "0.25"
tauri-plugin-global-shortcut = "2"

# Windows-specific
[target.'cfg(target_os = "windows")'.dependencies]
windows = { version = "0.61", features = [
  "Win32_Foundation",
  "Win32_UI_WindowsAndMessaging",
  "Win32_UI_Input_KeyboardAndMouse",
  "Win32_Graphics_Gdi",
  "Win32_System_Threading",
  "Win32_UI_HiDpi",
] }
windows-capture = "1"      # WinRT-based screen capture

[build-dependencies]
tauri-build = { version = "2", features = [] }
```

---

## Code Conventions

### TypeScript / React

- TypeScript strict mode: `"strict": true` in tsconfig — no `any` types
- State: Zustand only — one store (`appStore.ts`), no React Context for global state
- Components: functional + hooks only
- **Naming: be extremely clear** — mirror the original Swift file's naming philosophy
  (from `AGENTS.md` of original): `originalQuestionLastAnsweredDate` not `answerDate`
- No single-character variable names ever
- Format with Prettier before commit: `npx prettier --write src/`

### Rust

- No `.unwrap()` in production — use `?` or explicit error handling
- All Tauri commands return `Result<T, String>` — String error for JS interop
- Commands are THIN wrappers — no business logic in Rust unless it REQUIRES native OS APIs
- Use `cargo clippy --all-targets -- -D warnings` before every commit
- Use `cargo fmt` before every commit

### Do NOT

- ❌ Do not add features not in the original Clicky
- ❌ Do not rename things from the original without a comment explaining why
- ❌ Do not hardcode API keys anywhere — Worker secrets only
- ❌ Do not buffer full TTS response before playing — stream chunks
- ❌ Do not block the Rust main thread — use `async` commands
- ❌ Do not create a new WebSocket per push-to-talk session (see AssemblyAI note in original)
- ❌ Do not skip the click-through setup on the overlay window — the app is unusable without it
- ❌ Do not make the overlay window appear in the taskbar (`skip_taskbar: true`)
- ❌ Do not compress screenshots to PNG — use JPEG 75% quality to save Claude tokens

---

## Dev Environment Setup

```bash
# Prerequisites
# - Node.js 20+
# - Rust stable (rustup install stable)
# - Tauri CLI: npm install -g @tauri-apps/cli@latest
# - Wrangler: npm install -g wrangler
# - Windows SDK (for windows-capture crate)

# Install deps
npm install

# Dev mode (opens both windows with hot-reload)
npm run tauri dev

# Build release .exe installer
npm run tauri build
```

### Worker dev
```bash
cd worker && npm install
# Create worker/.dev.vars:
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
# DEEPGRAM_API_KEY=...
npx wrangler dev   # runs at http://localhost:8787
```

### Set VITE_WORKER_URL in .env
```
VITE_WORKER_URL=http://localhost:8787   # local dev
VITE_WORKER_URL=https://your-worker.workers.dev  # production
```

---

## Build Verification Checklist

Before calling any feature done, verify:

- [ ] Overlay window is full-screen, transparent, click-through, always-on-top
- [ ] Panel window appears near tray icon, dismisses on outside click
- [ ] Blue dot follows real cursor position in real time (polling via Rust)
- [ ] Hotkey registers globally (works when another app is focused)
- [ ] Push-to-talk waveform shows 5 animated bars during recording
- [ ] Interim transcripts show live in the overlay during recording
- [ ] Screenshot captures the correct monitor (the one with the cursor)
- [ ] Claude SSE tokens stream into overlay in real time
- [ ] TTS starts playing before Claude finishes responding
- [ ] [POINT] tags stripped from displayed text
- [ ] Blue dot animates to [POINT] coordinates via curved arc
- [ ] Multi-monitor: screen1 coordinates map correctly to second monitor
- [ ] Tray right-click menu works
- [ ] "Show Clicky" toggle hides/shows the overlay blue dot
- [ ] Conversation history persists across sessions within the same app run
- [ ] App does NOT appear in taskbar (only in system tray)
- [ ] No API keys in any source file or .env committed to git

---

## Git Workflow

- Branch: `feature/description` or `fix/description`  
- Commits: imperative mood, explain the WHY: `feat: add click-through to overlay window`
- Never force-push to main
- Keep `clicky-reference/` directory untouched — it is read-only reference material

---

## Key Reference URLs

- **Original Clicky repo (Swift source):** https://github.com/farzaa/clicky
- **Original AGENTS.md (read it!):** https://github.com/farzaa/clicky/blob/main/AGENTS.md
- **Tauri 2 docs:** https://v2.tauri.app
- **Tauri 2 window config:** https://v2.tauri.app/reference/config/
- **Tauri 2 capabilities:** https://v2.tauri.app/security/capabilities/
- **windows-capture crate:** https://crates.io/crates/windows-capture
- **Deepgram streaming docs:** https://developers.deepgram.com/docs/getting-started-with-live-streaming-audio
- **Anthropic SSE streaming:** https://docs.anthropic.com/en/api/messages-streaming
- **Prompt caching (use this!):** https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
- **Cloudflare Workers:** https://developers.cloudflare.com/workers/
- **Existing Windows ports for reference:**
  - .NET/WPF port: https://github.com/emreyilmaz46/clicky_windows
  - Electron port: https://github.com/tekram/clicky-windows

---

## Self-Update Rules

When you implement something and it changes the architecture, update this file:
1. **New files** → add to the project structure tree with a one-line description
2. **Changed commands** → update the Rust commands section
3. **New Worker routes** → update the Worker section  
4. **New dependencies** → update Cargo.toml section
5. Do NOT update for bug fixes or minor edits that don't change structure
