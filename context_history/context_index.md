# Context Index — Space Makeover Visualizer

Master index for orientation. First stop for any agent picking up this project.

## Project
Framework-free, no-build web app: photograph/upload a room → talk to a live Gemini voice agent that
sees the photo and edits it via function calling. Backend runtime is **Bun**. Spec: `PROMPT.md`.
Capability ledger + run instructions: `README.md`. Per-pass detail: `PASS_0.md`–`PASS_5.md`.

## Context Summaries

| Date | Phase | File | Summary |
|------|-------|------|---------|
| 2026-06-16 | implementation | contexts/2026-06-16_full-vertical-slice-build.md | Full Pass 0–5 build + Bun migration + QA fixes |

## Snapshots

| Date | File | Summary |
|------|------|---------|
| 2026-06-16 | snapshots/snapshot_2026-06-16_feature-complete.md | All 6 passes complete, feature-complete |

## Key Locations
- Server/proxy (Bun): `server/index.js`
- State contract: `js/state.js`
- Voice bridge: `js/actions/voiceSession.js`
- Verification (SDK/models/platform/Bun): `VERIFICATION_REPORT.md`
- Architectural decisions: `context_history/decisions.md`
