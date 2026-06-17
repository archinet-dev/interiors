# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

**Space Makeover Visualizer** — a responsive, device-aware web app that lets a user photograph a room and redesign it in real time by talking to a live voice agent that sees the photo, suggests changes, and edits the image on command.

**Current state: greenfield.** There is no application source code yet. The repo today contains only the spec, design wireframes, and a progress-tracking dashboard. The first coding work is Pass 0 (the walking skeleton) as defined in `PROMPT.md`.

### Authoritative files
- **`PROMPT.md`** — the complete product spec and the source of truth. It defines hard constraints, the required state/render contract, the architecture, the per-pass vertical-slice plan (Pass 0–5), acceptance criteria, risk register, and budgets. **Read it in full before writing any code.** When the spec and an inferred requirement conflict, the spec wins — stop and ask (constraint H5).
- **`wireframes/Space Makeover Visualizer Wireframes.html`** — the design wireframes to implement. (It is a self-unpacking "bundled page"; open it in a browser to view the rendered design rather than reading the raw HTML.)
- **`vertical-slice-dashboard.html`** — a standalone interactive dashboard for tracking the vertical-slice passes (acceptance criteria, risks, status). It is a project-management aid, not part of the shipped app.

## Tech stack & non-negotiable constraints

The stack is deliberately framework-free. These come from `PROMPT.md` "HARD CONSTRAINTS" and "STACK CONSTRAINT" — violating one rejects the pass, it is not iterated on:

- **Vanilla JS (ES2024+ modules), HTML5, CSS only.** No React/Vue/Svelte/Lit/Alpine, no Tailwind/Bootstrap. (H2)
- **No front-end build step.** The app must run from a static server with `<script type="module">` imports working directly. There is intentionally no bundler/transpiler for the UI layer.
- **No secrets in the client bundle, ever** — not even as a placeholder or comment. In the AI Studio runtime the key is injected at runtime (read it, never write it). If self-hosted, the key lives behind a server proxy. Route all SDK calls through one `apiClient.js` so swapping to a proxy is a config flip, not a refactor. (H1)
- **No deprecated APIs.** Specifically: no `ScriptProcessorNode` (use `AudioWorklet`), no `XMLHttpRequest` where `fetch` works, no `innerHTML` on user-controlled strings. (H3)
- **No orphan code.** Every file added in a pass must be reachable from the browser in that pass. (H4)
- **The only allowed dependency is `@google/genai`** (ES module import) for the Gemini Developer API and Live API. Everything else uses the web platform directly.

Modern platform features the spec expects you to lean on (June 2026 baseline): View Transitions API, Popover API + `<dialog>`, CSS Container Queries, CSS Nesting + `:has()`, `oklch()`/`color-mix()` design tokens, Custom Elements with Shadow DOM + `adoptedStyleSheets`, `getUserMedia`/`ImageCapture`, `AudioWorklet`, IndexedDB (tiny promise wrapper, not a library), `AbortController`, `structuredClone`.

## Architecture (target — built incrementally across passes)

Two AI layers bridged by **function calling**:
- **Voice layer:** Gemini Live API over a bidirectional WebSocket using a native-audio model (`gemini-2.5-flash-native-audio-preview-12-2025`). The current room image is passed as visual context on session start and on every edit.
- **Edit layer:** image editing via the Nano Banana family — `gemini-3.1-flash-image-preview` (fast default) and `gemini-3-pro-image-preview` (opt-in high quality).
- **The bridge:** the image-edit operation is registered as a tool the Live agent can call. The agent decides an edit is needed, calls `editImage({ prompt })`, receives the generated image, updates state, and narrates the result. This tool hand-off is the central mechanism (built in Pass 2).

> Model IDs and the `@google/genai` SDK surface must be verified against current docs before Pass 0 (the spec's PRE-CODE VERIFICATION GATE). Do not hardcode a model ID you have not confirmed is available; flag discrepancies instead of silently adapting.

### Required state/render pattern (do not deviate)
The whole app uses one pattern instead of a framework's reactivity:
- **`state.js`** — a ~30-line pub/sub exporting `getState()` (returns a frozen snapshot), `setState(partial)` (**shallow** merge of top-level keys, then notify), and `subscribe(fn)` (returns unsubscribe).
- **State is FLAT** — no nesting beyond one level, no deep merge. Extend with prefixed top-level keys (`voiceStatus`, `voiceTranscript`), never nested objects. The canonical shape is in `PROMPT.md`.
- Components subscribe on connect and re-render only the slices they depend on. **Renders are batched with `requestAnimationFrame`** (multiple `setState` calls in a frame coalesce).
- **No component mutates state directly.** All changes go through `setState`; all side-effectful work (API calls, recording) lives in `actions/*` modules that call `setState` on completion.
- Visual state transitions (active image swap, history additions) wrap their DOM update in `document.startViewTransition()`.
- **Blob URL discipline:** every `URL.createObjectURL` needs a matching `URL.revokeObjectURL`. Track the rendered Blob (not its URL string) when deciding whether to skip a re-render — `createObjectURL` returns a new string each call.

## Development methodology — vertical slice / walking skeleton

Build is multi-pass. **Every pass must leave the app fully runnable and browser-testable** — wire all layers together first (Pass 0), then add one user-visible capability per pass. No horizontal layering, no forward-scaffolding, no orphan code.

Each pass, before writing code, produces: (a) Acceptance Criteria (testable assertions a human can run in 5 minutes), (b) a Risk Register (1–3 pass-specific risks + mitigations), (c) a File Manifest (every file added/modified, one-line justification each). A pass is done only when every acceptance box is checked, budgets still hold, and a Pass Report is delivered in the format `PROMPT.md` specifies. Maintain a capability ledger in `README.md`, updated at the end of each pass.

Pass map (full detail in `PROMPT.md`): **0** walking skeleton (hardcoded photo + one edit button) → **1** real camera/upload → **2** voice tool call (central mechanism) → **3** edit history + undo/redo (IndexedDB) → **4** before/after + Pro render → **5** polish (themes, reduced-motion, PWA).

Budgets enforced every pass (not just at the end): first meaningful paint < 1.5s on throttled 4G; no main-thread task > 50ms during voice/edit; Lighthouse Accessibility ≥ 95; keyboard-only path works; animations respect `prefers-reduced-motion`; no heap growth across 50 consecutive edits.

## Running, building, testing

- **No build step** by design. Once `index.html` exists, serve the directory with any static file server (e.g. `python3 -m http.server` or `npx serve`) and open it — `<script type="module">` must work without transpilation. Note that camera (`getUserMedia`) and clipboard features require a secure context, so serve over `https`/`localhost`, not `file://`.
- **No package.json / test runner exists yet.** Do not invent build/lint/test commands; if a toolchain is added, document the real commands here. Verification today is browser-based: load the app and check each pass's acceptance criteria against observed behavior (per the user's "observe before testing" rule), watching DevTools for console/network errors and memory leaks.
