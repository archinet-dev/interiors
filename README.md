# Space Makeover Visualizer

A framework-free, device-aware web app that lets you photograph a room and redesign it in
real time by talking to a live voice agent that sees the photo, suggests changes, and edits
the image on command.

Built as a vertical-slice walking skeleton — the app is fully runnable after every pass. See
`PROMPT.md` for the full spec; per-pass reports, the pre-code verification, design tokens,
wireframes, and the architectural-decision log live under `docs/`.

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

## Prototype hosting

The prototype is hosted on **Replit** (see `.replit`): **https://outlouddesign.replit.app**.
Replit publishes directly to `main` ("Published your App" commits), so pull before starting
local work. The key lives in Replit Secrets, never in the repo.

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

### Pass 6 — Reference Items ✅
- **Tray:** `<reference-tray>` ("Your items") — attach up to 4 photos of specific objects, furniture,
  decor, tiles, or wallpaper via a file picker (multi-select) or drag-and-drop; thumbnails with remove,
  a live n/4 count, and per-id Blob-URL revocation. Non-images and over-cap attempts toast.
- **Edits:** attached items ride along with **every** edit — the room image goes first, each reference
  after it, with framing text that scopes their use to instructions that refer to them. A one-tap
  **Add to room** button incorporates everything attached (place furniture/decor, apply materials to
  the right surfaces).
- **Voice:** the live agent is shown each attached item (on session start and the moment one is added)
  and its instructions cover using them — "add the armchair from the reference photo next to the window".
- **Persistence:** references are part of the saved session, so a reload restores the tray;
  "New photo" clears it.

### Pass 7 — Export Controls: Aspect Ratio + Upscale ✅
- **Export dialog:** ↧ Download opens a native `<dialog>` with shape and size options. Defaults —
  **Original / Standard** — download the exact current image instantly, no API call.
- **Generative expand:** picking a new shape (1:1, 4:3, 16:9, 4:5, 9:16) extends the room's scene
  outward to fill the new canvas via `imageConfig.aspectRatio` — nothing is cropped or stretched.
- **Upscale:** 2K / 4K render via the Pro model's `imageSize`. "Original" upscales snap to the
  nearest supported ratio (the model drifts the shape if the config is omitted — live-verified).
- **Keep in history:** optional checkbox appends the render as an undoable, persisted edit;
  Share from the dialog uses the Web Share API with download fallback.

### Pass 8 — Touch the Room: Tap-to-Select ✅
- **Tap anything:** tapping the photo asks `gemini-3.5-flash` what's there (point → label + box +
  best-effort polygon) and draws a marching-ants outline over it; the bar shows
  "Selected: {label} — your next edit changes only this".
- **Targeted edits:** while something is selected, every edit path (button, chip, voice) scopes
  itself to that object — verified surgically (an emerald-velvet sofa recolor left the rest of
  the room pixel-faithful). History entries carry the object label.
- **Voice targeting:** the Live agent's `editImage` tool gained an optional `target` — "make just
  the coffee table walnut" locates, outlines, and edits only the table; tap selections are
  announced to the agent and always win.
- **Model migration:** image models moved to the stable GA IDs (`gemini-3.1-flash-image`,
  `gemini-3-pro-image`), live-verified; masks route to `gemini-3.5-flash` (Gemini 3 image models
  don't support them).

### Pass 9 — Make It Real: Grounded Renders + Real Matches ✅
- **Grounded edits:** Flash edits search Google Web + Image Search mid-render
  (`googleSearch.searchTypes`) and base changes on real, currently-sold products. Default on;
  Settings → "Real products" turns it off. Pro edits skip grounding (Flash-only capability).
- **Real matches rail:** each grounded edit shows the sources it referenced and Google's required
  search-suggestions widget under the photo; persisted with the history entry, survives reloads.
- **Instant drafts:** targeted edits show a ~4 s `gemini-3.1-flash-lite-image` draft in place
  (with a "Draft — refining…" badge) while the full render finishes; drafts never enter history.

**All nine passes complete.** The app: capture/upload a room → talk to a live AI that sees it and edits
it via function calling → tap any object (or name it) to edit exactly that, grounded in real products
with sources shown → attach photos of specific items/materials to work into the design → review the
persisted history (undo/redo/branch) → compare before/after → opt into Pro renders → export at any
shape/size with generative expand → installable, themed, and accessible.

### Known manual-verification items
Real camera capture, live mic/speaker audio, reduced-motion under OS emulation, and Lighthouse
(a11y ≥95 / 4G first paint) are code-verified here and flagged for a hands-on device/Lighthouse pass.

**Verified against the live Gemini API (2026-07-10):** reference-item edit fidelity (an attached
armchair photo was reproduced faithfully in the room by "Add to room") and the voice tool-call
bridge with attachments (a real Live session saw the reference, tool-called `editImage`, and
narrated the applied edit). Details in `docs/passes/PASS_6.md` §5.
