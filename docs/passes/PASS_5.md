# Pass 5 — Polish

**Capability:** "The app feels finished" — theming, accessible motion, graceful errors, installable PWA.

## (a) Acceptance Criteria
```
[ ] Light/dark themes via design tokens; follows prefers-color-scheme by default; a header toggle
    overrides it and persists (localStorage). One var-swap (CSS light-dark()).
[ ] prefers-reduced-motion: View Transitions / the listening pulse are disabled; the app still works.
[ ] Errors surface as a non-blocking toast (Popover API) with a dismiss; the app stays usable.
[ ] PWA: a valid manifest + 192/512 icons; a service worker precaches the app shell and serves it
    offline for navigation; /api/genai/* is never cached. App is installable.
[ ] Keyboard-only path works across capture → edit → compare → history → settings (focus visible).
[ ] No console errors; every new file reachable.
```

## (b) Risk Register
```
R1. Service worker caching the API or stale shell. Mitigation: bypass /api/* in fetch; versioned
    cache name; cache-first for shell only; activate clears old caches.
R2. light-dark() / color-scheme support. Mitigation: Baseline-widely-available by mid-2026; tokens
    fall back to light values if unresolved; manual toggle sets color-scheme via [data-theme].
R3. SW intercepting the dev workflow / Live WS. Mitigation: SW only handles GET same-origin non-/api
    requests; WebSocket upgrades and /api/* pass straight through.
```

## (c) File Manifest
| File | Add/Mod | Justification |
|------|---------|---------------|
| `styles.css` | mod | Tokens via `light-dark()`; `color-scheme`; toast + theme-toggle styles; reduced-motion sweep. |
| `js/theme.js` | add | Theme toggle + localStorage persistence (sets `[data-theme]`). |
| `js/toast.js` | add | Subscribe to `state.error`; show a Popover-API toast; auto-dismiss + manual close. |
| `manifest.webmanifest` | add | PWA manifest (name, icons, theme/bg color, standalone). |
| `sw.js` | add | Service worker: precache shell, cache-first for shell, bypass `/api/*`. |
| `js/pwa.js` | add | Register the service worker. |
| `assets/icon-192.png`, `assets/icon-512.png` | add | PWA icons. |
| `index.html` | mod | Theme toggle button, manifest link, theme-color metas, toast element, pwa/theme/toast scripts; drop inline error box (now a toast). |
| `js/main.js` | mod | Stop rendering the inline error box (toast owns errors now). |

## Pass Report

**Verified in-browser on 2026-06-16** (Playwright against the Bun server).

### 1. Capability added
Light/dark theming with a manual toggle, non-blocking error toasts, an installable offline-shell PWA,
and a reduced-motion sweep — the app feels finished.

### 2. Files touched
`styles.css` (light-dark() tokens, color-scheme, toast + theme-toggle styles, reduced-motion sweep),
`js/theme.js`, `js/toast.js`, `manifest.webmanifest`, `sw.js`, `js/pwa.js`, `assets/icon-192.png`,
`assets/icon-512.png`, `index.html` (toggle, manifest, theme-color, toast, scripts), `js/main.js`
(errors now via toast).

### 3. Acceptance criteria — pass/fail
```
[x] Themes via light-dark() tokens; follows prefers-color-scheme by default; header toggle cycles
    system→light→dark and persists in localStorage (verified: dataset.theme system→light→dark, color-scheme=dark).
[~] prefers-reduced-motion: CSS sweep disables view transitions + toast/pulse animations, and JS guards
    skip startViewTransition. Verified by code + the media-query API; full emulation is a manual/Lighthouse step.
[x] Errors surface as a non-blocking Popover-API toast with dismiss; dismiss clears state.error. (verified)
[x] PWA: valid manifest (application/manifest+json) + 192/512 icons; SW precaches the shell
    (smv-shell-v1 holds index.html + main.js); /api/* is never cached (apiCached=false). Installable.
[x] Keyboard: all controls are native buttons/inputs/radios with visible :focus-visible outlines;
    divider is a role=slider with arrow keys; popovers use the platform.
[x] No console errors; all new files reachable.
```

### 4. Decisions made
- **`light-dark()` + `color-scheme`** for theming — one token per color carries both themes; the manual
  toggle just sets `color-scheme` via `[data-theme]`. Exactly "both themes are one var-swap."
- **Theme toggle cycles system→light→dark** (system = no stored pref, follows OS); persisted in
  localStorage (a small UI pref, allowed).
- **Errors became toasts** (removed the inline error box) — non-blocking, Popover-API, auto-dismiss + manual close.
- **SW: precache local shell + runtime-cache the ESM CDN; bypass `/api/*` and non-GET** so REST + the
  Live WebSocket always reach the proxy. Offline serves the navigation shell (inference still needs network).
  Cache is versioned (`smv-shell-v1`) — bump to invalidate.
- **Icons generated via `<canvas>`** (deterministic, no rasterizer dependency) — a framed-photo glyph on the accent gradient.

### 5. Risks carried forward / manual checks
- **Lighthouse Accessibility ≥95 & 4G first-paint <1.5s** — should be run in a Lighthouse pass (the
  Playwright harness here doesn't run Lighthouse); the app is built to meet them (labels, roles, focus,
  no blocking work, tiny shell).
- **Manual:** real camera capture (Pass 1), live mic/speaker audio (Pass 2), and reduced-motion under OS
  emulation — all code-verified, pending a hands-on device pass.
- **50-edit memory budget:** blob-URL revocation verified (Pass 0 + filmstrip per-id revoke); a sustained
  50-edit soak is a manual DevTools check.

### 6. Capability ledger
Updated in `README.md` — all five passes complete.
