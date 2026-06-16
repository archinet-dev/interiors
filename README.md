# Space Makeover Visualizer

A framework-free, device-aware web app that lets you photograph a room and redesign it in
real time by talking to a live voice agent that sees the photo, suggests changes, and edits
the image on command.

Built as a vertical-slice walking skeleton — the app is fully runnable after every pass. See
`PROMPT.md` for the full spec and `VERIFICATION_REPORT.md` for the pre-code verification.

## Running locally

The app talks only to a local Bun proxy that injects the Gemini API key server-side — the key
never enters the client bundle (constraint H1). No build step.

```bash
# 1. Put your key in .env (git-ignored):  GEMINI_API_KEY=...  (Bun auto-loads .env)
# 2. Start the server (Bun >=1.2, zero dependencies):
bun run start          # or: bun server/index.js   (bun --watch server/index.js for auto-reload)
# 3. Open http://localhost:5173/
```

The camera/clipboard features in later passes require a secure context (localhost qualifies).

## Tech stack

Vanilla JS (ES2024+ modules), HTML5, CSS only on the front end — no framework, no bundler. The
only client dependency is `@google/genai` (loaded as ESM via an import-map). The backend runtime
is **Bun ≥1.2** (H6): the dev server + proxy (`server/index.js`) use `Bun.serve()` / `Bun.file()`
and Bun's automatic `.env` loading — no Node, no npm packages.

## Architecture

- `state.js` — flat pub/sub store (getState / setState / subscribe), rAF-batched renders.
- `apiClient.js` — the single chokepoint for all `@google/genai` calls; pointed at the proxy.
- `actions/*` — side-effect modules; the only place that calls the API and then `setState`.
- `main.js` — wires UI ↔ state, renders, owns Blob-URL lifecycle and View Transitions.
- `server/index.js` — Bun (`Bun.serve()`) static server + transparent Gemini proxy (key injected from env).

---

## Capability Ledger

### Pass 0 — Walking Skeleton ✅
- **Frontend:** `index.html` loads a hardcoded sample room photo in a centered card with one
  "Try a sample edit" button. Tokens from the wireframes; reduced-motion respected.
- **State:** `state.js` flat store — frozen snapshots, shallow merge, rAF-batched notify.
- **API:** `apiClient.js` wraps `@google/genai` (`gemini-3.1-flash-image-preview`), exports
  `editImage(blob, prompt)`; routed through the local proxy.
- **Action:** `actions/editImage.js` runs the edit and updates state.
- **Render:** `main.js` swaps the `<img>` inside `document.startViewTransition()` with
  Blob-URL revocation; button shows an "Editing…" in-flight state.
- **Server/proxy:** `server/index.js` (Bun) serves the app and injects `GEMINI_API_KEY` into
  upstream Gemini calls — no key in the client bundle (H1), Bun runtime (H6).

### Pass 1 — Real Camera / Upload ✅
- **Capture:** `<camera-capture>` custom element (Shadow DOM) — live camera (`getUserMedia` →
  `<canvas>.toBlob()`, not `ImageCapture`), file upload, drag-and-drop, and a "Use sample" path.
  Permission-denial degrades to upload/sample with a message and no console error.
- **Flow:** the captured/uploaded Blob → `setPhoto` action → `sourceImage`+`activeImage`; the UI
  toggles between the capture surface and the room view; "New photo" returns to capture.

### Pass 2 — Voice Tool Call (central mechanism) ✅
- **Live voice agent:** `<voice-indicator>` toggles a Gemini Live session (native-audio) via
  `actions/voiceSession.js`. The agent sees the photo, and a registered `editImage` function call
  is the bridge: tool call → real Nano-Banana edit → `activeImage` update → new image fed back →
  agent narrates. Transcripts (input + output) mirror into `state.voiceTranscript`.
- **Audio:** mic captured at 16 kHz via an `AudioWorklet` (no `ScriptProcessorNode`); the agent's
  24 kHz PCM is played back gaplessly; barge-in flushes playback.
- **Key handling (H1):** the Live **WebSocket** is reverse-proxied by the Bun server
  (`/api/genai/ws/*`), which injects the key into the upstream `wss://` — the browser never holds it.

### Pass 3 — Edit History + Undo/Redo ✅
- **History:** `actions/history.js` keeps a list + pointer; entry 0 is the original. Each edit (button
  or voice) appends; undo/redo move the pointer; clicking a `<edit-history>` filmstrip thumbnail
  reverts; editing from a past point branches (truncate forward + append).
- **Persistence:** `db/idb.js` (tiny IndexedDB wrapper, no library) stores the session so a reload
  restores the filmstrip + active image; "New photo" clears it.
- **Keyboard:** Cmd/Ctrl+Z undo, Shift+Cmd/Ctrl+Z redo (plus Undo/Redo buttons).

### Pass 4 — Before/After + High-Quality Render ✅
- **Compare:** `<before-after>` element layers the original under the current image and reveals it
  with a draggable, keyboard-accessible divider (role=slider). The Compare toggle animates via a
  View Transition.
- **Quality:** a native Popover-API Settings panel offers Flash (default) vs Pro
  (`gemini-3-pro-image-preview`, up to 4K). The choice applies to button + voice edits; the Pro
  cost/quality tradeoff is surfaced as a hint.

### Pass 5 — Polish ✅
- **Theming:** light/dark via `light-dark()` design tokens + `color-scheme`; a header toggle cycles
  system → light → dark and persists in `localStorage`.
- **Errors:** non-blocking Popover-API toasts (`js/toast.js`) driven by `state.error`.
- **Motion:** a `prefers-reduced-motion` sweep disables View Transitions and decorative animation;
  JS guards skip `startViewTransition`.
- **PWA:** `manifest.webmanifest` + canvas-generated 192/512 icons + a service worker (`sw.js`) that
  precaches the app shell and serves it offline (inference still needs network); `/api/*` is never cached.

**All five passes complete.** The app: capture/upload a room → talk to a live AI that sees it and edits
it via function calling → review the persisted history (undo/redo/branch) → compare before/after →
opt into Pro renders → installable, themed, and accessible.

### Known manual-verification items
Real camera capture, live mic/speaker audio, reduced-motion under OS emulation, and Lighthouse
(a11y ≥95 / 4G first paint) are code-verified here and flagged for a hands-on device/Lighthouse pass.
