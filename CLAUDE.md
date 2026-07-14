# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> `AGENTS.md` is the agent-neutral counterpart of this file for other coding agents — **if you change one, make the same change in the other; they must not drift.**

## What this repo is

**Space Makeover Visualizer** — a responsive, device-aware web app that lets a user photograph a room and redesign it in real time by talking to a live voice agent that sees the photo, suggests changes, and edits the image on command.

**Current state: feature-complete through Pass 8** (walking skeleton → camera/upload → voice tool call → history/undo → before-after + Pro renders → polish/PWA → reference items → export controls → tap-to-select targeted edits). The capability ledger in `README.md` is the authoritative list of what works today. New work should be a new vertical-slice pass (or a fix) that keeps the app fully runnable.

### Authoritative files
- **`PROMPT.md`** — the complete product spec and the source of truth. It defines hard constraints, the required state/render contract, the architecture, the vertical-slice methodology, acceptance criteria, risk register, and budgets. When the spec and an inferred requirement conflict, the spec wins — stop and ask (constraint H5).
- **`README.md`** — run instructions + the per-pass capability ledger (updated at the end of every pass).
- **`docs/`** — supporting documents, none of them shipped app code:
  - `docs/passes/PASS_0.md`–`PASS_6.md` — historical pass reports (acceptance criteria, risks, file manifests).
  - `docs/VERIFICATION_REPORT.md` — the pre-code verification of SDK surface, model IDs, and platform features.
  - `docs/decisions.md` — append-only architectural-decision log (the code shows *what*; this shows *why*). Add a row when you make a decision of that weight.
  - `docs/DESIGN_TOKENS.md` + `docs/wireframes/` — design tokens and the original wireframes (the wireframe HTML is a self-unpacking "bundled page"; open it in a browser rather than reading the raw HTML).
  - `docs/vertical-slice-dashboard.html` — standalone pass-tracking dashboard (project-management aid).
  - `docs/manual.html` — the user manual, linked from the app header (this one **is** user-facing).

## Running, building, testing

- **No build step, no npm dependencies.** The backend runtime is **Bun ≥1.2** (constraint H6); `package.json` exists only to declare the runtime and scripts — do not add dependencies.
- Put the Gemini key in `.env` (git-ignored): `GEMINI_API_KEY=...` — Bun auto-loads it.
- `bun run start` (or `bun --watch server/index.js` for auto-reload), then open http://localhost:5173/.
- `server/index.js` is a zero-dependency `Bun.serve()` static server + transparent Gemini proxy: it injects the key into upstream REST calls **and** reverse-proxies the Live WebSocket (`/api/genai/ws/*`) so the browser never holds the key (H1).
- `.replit` exists because the prototype is hosted on Replit at **https://outlouddesign.replit.app**; keep it working if you touch server startup (it expects the server to honor `PORT` and bind externally). Replit publishes commits directly to `main`, so pull before starting local work.
- **No test runner exists.** Do not invent build/lint/test commands. Verification is browser-based: load the app and check acceptance criteria against observed behavior, watching DevTools for console/network errors and memory leaks. Camera/mic/clipboard need a secure context (localhost qualifies).

## Tech stack & non-negotiable constraints

The stack is deliberately framework-free. These come from `PROMPT.md` "HARD CONSTRAINTS" and "STACK CONSTRAINT" — violating one rejects the pass, it is not iterated on:

- **Vanilla JS (ES2024+ modules), HTML5, CSS only.** No React/Vue/Svelte/Lit/Alpine, no Tailwind/Bootstrap. (H2)
- **No front-end build step.** `<script type="module">` imports must work directly from a static server.
- **No secrets in the client bundle, ever** — the key lives in `.env` and is injected by the Bun proxy. All SDK calls route through `js/apiClient.js` so swapping the proxy is a config flip, not a refactor. (H1)
- **No deprecated APIs.** No `ScriptProcessorNode` (use `AudioWorklet`), no `XMLHttpRequest` where `fetch` works, no `innerHTML` on user-controlled strings. (H3)
- **No orphan code.** Every file added in a pass must be reachable from the browser in that pass. (H4)
- **The only allowed client dependency is `@google/genai`** (ESM via import-map). Everything else uses the web platform directly.

Platform features in active use: View Transitions API, Popover API, CSS Container Queries, CSS Nesting + `:has()`, `oklch()`/`light-dark()` design tokens, Custom Elements with Shadow DOM + `adoptedStyleSheets`, `getUserMedia`, `AudioWorklet`, IndexedDB (tiny promise wrapper in `js/db/idb.js`, not a library), `AbortController`, service worker + manifest (PWA).

## Architecture

Two AI layers bridged by **function calling**:
- **Voice layer:** Gemini Live API over a reverse-proxied WebSocket using a native-audio model. The current room image and any reference items are sent as visual context on session start and after every edit.
- **Edit layer:** image editing via `gemini-3.1-flash-image-preview` (fast default) and `gemini-3-pro-image-preview` (opt-in high quality). Model IDs are constants in `js/apiClient.js` / `js/actions/voiceSession.js`, verified in `docs/VERIFICATION_REPORT.md` — do not change them silently (H5).
- **The bridge:** `editImage({ prompt })` is registered as a tool on the Live session. Agent decides an edit is needed → tool call → real edit → state update → new image fed back → agent narrates.

Key modules: `js/state.js` (flat pub/sub store), `js/apiClient.js` (single SDK chokepoint), `js/actions/*` (all side effects), `js/main.js` (UI wiring, Blob-URL lifecycle, View Transitions), `js/components/*` (custom elements), `js/db/idb.js` (IndexedDB persistence), `server/index.js` (Bun server/proxy).

### Required state/render pattern (do not deviate)
- **`js/state.js`** — pub/sub exporting `getState()` (frozen snapshot), `setState(partial)` (**shallow** merge of top-level keys, then notify), `subscribe(fn)`.
- **State is FLAT** — extend with prefixed top-level keys (`voiceStatus`, `voiceTranscript`), never nested objects.
- Components subscribe and re-render only the slices they depend on. **Renders are batched with `requestAnimationFrame`.**
- **No component mutates state directly.** All changes go through `setState`; all side-effectful work lives in `actions/*`.
- Visual transitions (active image swap, history additions) wrap DOM updates in `document.startViewTransition()` (guarded for `prefers-reduced-motion`).
- **Blob URL discipline:** every `URL.createObjectURL` needs a matching `URL.revokeObjectURL`. Track the rendered Blob (not its URL string) when deciding whether to skip a re-render.

## Development methodology — vertical slice

**Every pass leaves the app fully runnable and browser-testable.** Before writing code, a pass produces: (a) Acceptance Criteria a human can run in 5 minutes, (b) a Risk Register (1–3 pass-specific risks + mitigations), (c) a File Manifest. A pass is done only when every acceptance box is checked, budgets hold, and a Pass Report is delivered (add it as `docs/passes/PASS_N.md`) and the `README.md` ledger is updated.

Budgets enforced every pass: first meaningful paint < 1.5s on throttled 4G; no main-thread task > 50ms during voice/edit; Lighthouse Accessibility ≥ 95; keyboard-only path works; animations respect `prefers-reduced-motion`; no heap growth across 50 consecutive edits.
