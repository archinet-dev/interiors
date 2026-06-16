# Space Makeover Visualizer

A framework-free, device-aware web app that lets you photograph a room and redesign it in
real time by talking to a live voice agent that sees the photo, suggests changes, and edits
the image on command.

Built as a vertical-slice walking skeleton — the app is fully runnable after every pass. See
`PROMPT.md` for the full spec and `VERIFICATION_REPORT.md` for the pre-code verification.

## Running locally

The app talks only to a local proxy that injects the Gemini API key server-side — the key
never enters the client bundle (constraint H1). No build step.

```bash
# 1. Put your key in .env (git-ignored):  GEMINI_API_KEY=...
# 2. Start the server (Node 18+, zero npm dependencies):
node server.js
# 3. Open http://localhost:5173/
```

The camera/clipboard features in later passes require a secure context (localhost qualifies).

## Tech stack

Vanilla JS (ES2024+ modules), HTML5, CSS only. No front-end framework, no bundler. The only
dependency is `@google/genai` (loaded as ESM via an import-map). The local Node proxy
(`server.js`) uses Node built-ins only.

## Architecture

- `state.js` — flat pub/sub store (getState / setState / subscribe), rAF-batched renders.
- `apiClient.js` — the single chokepoint for all `@google/genai` calls; pointed at the proxy.
- `actions/*` — side-effect modules; the only place that calls the API and then `setState`.
- `main.js` — wires UI ↔ state, renders, owns Blob-URL lifecycle and View Transitions.
- `server.js` — local static server + transparent Gemini proxy (key injected from env).

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
- **Server/proxy:** `server.js` serves the app and injects `GEMINI_API_KEY` into upstream
  Gemini calls — no key in the client bundle (H1).

_Not yet built:_ real camera/upload (Pass 1), voice tool-call (Pass 2), edit history + undo
(Pass 3), before/after + Pro render (Pass 4), themes/PWA polish (Pass 5).
