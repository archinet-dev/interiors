# Pass 0 — Walking Skeleton

**Capability:** "User opens the app, sees a hardcoded room photo, clicks one button, and watches it transform via the image-edit API."

This proves the full stack is wired: SDK works, key handling works (via a local proxy, never in the client bundle — H1), state→render works, View Transitions work.

---

## Pre-code artifacts

### (a) Acceptance Criteria — human-runnable in 5 minutes

```
Pass 0 — Acceptance Criteria
[ ] `node server.js` starts; opening http://localhost:5173/ loads the app. No 404s. No console errors.
[ ] Sample room image is visible within 2s, in a centered white card on the paper background.
[ ] "Try a sample edit" button is visible and enabled once the image loads.
[ ] Clicking the button: button shows "Editing…" within 100ms and disables.
[ ] The image swaps to an edited version within ~10s via a visible cross-fade (View Transition).
[ ] A second click swaps again (state→render is idempotent, not one-shot).
[ ] DevTools Memory: blob URLs are revoked — heap does not grow monotonically across 10 clicks.
[ ] getState() returns a frozen object; mutating it throws in strict mode.
[ ] No string matching "YOUR_", "API_KEY=", or "sk-" exists in any CLIENT file (index.html, /js/**, /assets/**, /styles.css). (grep before claiming done — server.js + .env are NOT client files.)
[ ] Network tab: the SDK request goes to the local proxy (/api/genai/...), NOT directly to googleapis.com, and carries no key from the browser.
[ ] Reduced-motion: with `prefers-reduced-motion: reduce`, the swap still happens (no animation, no error).
[ ] Every file added this pass is reachable from index.html or a module it loads (manifest below — justify each).
```

### (b) Risk Register — Pass 0 specific

```
R1. SDK browser ESM build pointed at a proxy baseUrl with a placeholder key may reject the
    request or not honor httpOptions.baseUrl.
    Mitigation: validate the exact request/response shape with a raw curl FIRST (observe before
    coding). If the SDK resists the proxy, apiClient.js falls back to a plain fetch() to the same
    proxy endpoint — the public editImage(blob, prompt) signature stays identical, so no caller
    changes. Decision recorded either way.

R2. Image model returns an unexpected response shape (no inlineData / safety block / different
    part ordering) → broken render with a cryptic error.
    Mitigation: parse defensively — scan ALL parts for the first inlineData; if none, surface the
    model's text part (or a clear error) into state.error and show it. Full error to the user (per
    user rule). Validated against the real response in the pre-code curl step.

R3. Blob URL leak across repeated edits (spec H + budget: no monotonic heap growth over 50 edits).
    Mitigation: main.js tracks the currently-rendered Blob (not URL string) and revokes the prior
    object URL on every successful swap. Verified via the 10-click memory check in AC.
```

### (c) File Manifest — every file added/modified, one-line justification

| File | Add/Mod | Justification |
|------|---------|---------------|
| `server.js` | add | Local static server + transparent proxy for `/api/genai/*` → Gemini, injecting the key from env. Holds H1: key never enters the client bundle. **Server file, not client.** |
| `index.html` | add | The one page. `<main>` with the room `<img>` and the single `<button>`. Loads styles + `js/main.js` as a module; declares the import-map for `@google/genai`. |
| `styles.css` | add | Minimal centered, responsive layout + design tokens as CSS custom properties (from `DESIGN_TOKENS.md`). |
| `js/state.js` | add | The ~30-line pub/sub: `getState()` (frozen snapshot), `setState(partial)` (shallow merge), `subscribe(fn)`. rAF-batched notify. |
| `js/apiClient.js` | add | Wraps `@google/genai`; exports `editImage(blob, prompt)`. SDK pointed at the local proxy baseUrl. The single chokepoint for all SDK calls (proxy↔direct is a config flip). |
| `js/actions/editImage.js` | add | Side-effect module: sets `editingInFlight`, calls `apiClient.editImage`, writes `activeImage`/`error` via `setState`. No component touches the API directly. |
| `js/main.js` | add | Wires button → action; subscribes to state; swaps `<img>` inside `document.startViewTransition()`; manages blob-URL lifecycle. |
| `assets/sample-room.jpg` | add | The hardcoded bundled source photo Pass 0 edits. |
| `README.md` | add | Capability ledger (updated at end of every pass). |
| `PASS_0.md` | add | This file — Pass 0 artifacts + pass report. |

---

## Pass Report

**Verified in-browser on 2026-06-15** (Playwright against `node server.js` at http://localhost:5173/).

### 1. Capability added
User opens the app, sees a hardcoded sample room photo, clicks one button, and watches it
transform (a houseplant added to the empty corner) via the real Gemini image-edit API — proving
the full stack is wired: SDK → proxy → Gemini → state → View-Transition render.

### 2. Files touched
See File Manifest above. Net adds: `server.js`, `package.json`, `index.html`, `styles.css`,
`js/state.js`, `js/apiClient.js`, `js/actions/editImage.js`, `js/main.js`, `assets/sample-room.jpg`,
`README.md`, `PASS_0.md`. Supporting (not app): `VERIFICATION_REPORT.md`, `DESIGN_TOKENS.md`.

### 3. Acceptance criteria — pass/fail
```
[x] `node server.js` starts; http://localhost:5173/ loads. No 404s, no console errors. (favicon 404 fixed)
[x] Sample room image visible immediately in a centered white card on the paper background.
[x] "Try a sample edit" button visible and enabled once the image loads.
[x] Click → button shows "Editing…" and disables. (observed)
[x] Image swaps to an edited version within ~10s via a View Transition cross-fade. (plant added)
[x] Second click swaps again — state→render is idempotent, not one-shot. (2 proxy POSTs, both 200)
[x] Blob URLs revoked — 8 swaps → 8 created / 8 revoked, converges to exactly 1 live URL. No leak.
[x] getState() returns a frozen object; mutation throws in strict mode. (verified)
[x] No "YOUR_"/"API_KEY="/"sk-"/"AIza" string in any client file. (grep clean; key only in .env + server.js)
[x] SDK request goes to the local proxy (/api/genai/...), not directly to googleapis.com. (proxy log confirms)
[~] Reduced-motion: swap still happens with no animation. (code path + CSS verified; not exercised under emulation)
[x] Every file added this pass is reachable from index.html / a module it loads. (manifest justified)
```

### 4. Decisions made
- **Local proxy (server.js).** Per the user's sign-off. One same-origin Node server serves the
  app AND proxies `/api/genai/*` to Gemini with the key injected from `.env` — no key in the client
  bundle (H1), no CORS. Zero npm dependencies (Node built-ins only) to honor "no build step."
- **SDK pointed at the proxy via `httpOptions.baseUrl`.** Resolves Risk R1 — verified the browser
  SDK works through the proxy (proxy logged the 200), so the plain-`fetch` fallback was not needed.
- **Model IDs verbatim from spec** (`gemini-3.1-flash-image-preview`), held as constants in
  `apiClient.js` (preview→GA swap is one edit). Confirmed callable (HTTP 200).
- **Sample photo is AI-generated** (via the image model itself) — avoids licensing and dogfoods the
  pipeline. 1408×768 JPEG committed at `assets/sample-room.jpg`.
- **CDN import-map** (`esm.run/@google/genai@2.8.0`) so the bare `@google/genai` import resolves
  with no bundler.
- **`package.json`** added with only `{"type":"module"}` + a start script — declares ESM for
  `server.js`; not a build step, no dependencies.

### 5. Risks carried forward
- **Live API over WebSocket through the proxy (Pass 2).** Pass 0 only proved the REST path. The
  proxy must handle a WS upgrade for `ai.live.connect`; spike this first in Pass 2.
- **Reduced-motion full verification.** Exercise under `prefers-reduced-motion` emulation in a later
  pass (and as part of the standing accessibility budget).
- **Lighthouse Accessibility ≥ 95 / 4G first-paint < 1.5s budgets.** Not yet measured; run before
  Pass 1 sign-off as the UI gains real controls.

### 6. Capability ledger
Updated in `README.md` (Pass 0 section).
