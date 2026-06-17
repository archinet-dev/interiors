## Milestone State — Feature Complete — 2026-06-16

### Exists (all browser-verified against the real Gemini API via the Bun server)
- Pass 0 — Walking skeleton: sample photo + one edit, full stack wired.
- Bun migration (H6): Node `server.js` → `server/index.js` (`Bun.serve()`).
- Pass 1 — Camera/upload: `<camera-capture>` (camera/upload/drag-drop/sample), permission-denial path.
- Pass 2 — Voice tool-call: Live native-audio session via Bun-proxied WebSocket; `editImage` function
  call bridge; transcripts; AudioWorklet mic + PCM playback.
- Pass 3 — Edit history: `<edit-history>` filmstrip, undo/redo (keyboard + buttons), branch, IndexedDB persistence.
- Pass 4 — Before/after `<before-after>` slider + Settings popover Flash/Pro (Pro edit verified).
- Pass 5 — Polish: light/dark themes (light-dark()), error toasts, reduced-motion sweep, PWA (manifest + SW + icons).
- Multi-agent QA: code review + hard-constraint audit (H1–H6 PASS); 12 findings fixed and re-verified.

### In Progress
- None — feature-complete per `PROMPT.md`.

### Blockers
- None.

### Next Steps (manual / hands-on)
- Real camera capture and live mic/speaker audio on a device.
- Reduced-motion under OS emulation; Lighthouse a11y ≥95 / 4G first-paint budget run.
- Optional: more reliable SDK delivery (one transient esm.run transitive 404 observed).

### Repo
- Branch: `pass-0-walking-skeleton` (not yet merged to main).
- Commits: e9b9458 (init) → fb9f6f6 (Bun) → ccf7e4e → 6ed81b5 → f9c6509 → f5b93c5 → 0435338 → c15df16 (QA fixes).
- Run: `bun run start` → http://localhost:5173/ (needs `GEMINI_API_KEY` in `.env`).
