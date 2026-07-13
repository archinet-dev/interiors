# Architectural Decisions — Space Makeover Visualizer

Append-only. Why things were built this way (the code shows *what*; this shows *why*).

| Date | Decision | Reasoning | Alternatives Considered |
|------|----------|-----------|------------------------|
| 2026-06-16 | Local **Bun** proxy injects the API key from env; browser SDK uses `httpOptions.baseUrl` → proxy | Satisfies H1 (no key in client) + H6 (Bun runtime) with no CORS; one same-origin server serves app + proxies REST and the Live WebSocket | Runtime-entered key in sessionStorage (rejected by user); AI-Studio-only (no local static test) |
| 2026-06-16 | Reverse-proxy the Live **WebSocket** in Bun (`/api/genai/ws/*`) | SDK derives `ws://` from the http baseUrl and puts the key in `?key=`; proxy strips the placeholder and injects the real key upstream — browser never holds it | Direct browser→Google WS (would expose key in URL); separate WS server |
| 2026-06-16 | No build step; `@google/genai` via import-map (esm.run) | Hard constraint H2 (no bundler); native ES modules | Bundler/Vite (forbidden); self-hosted SDK copy (heavier) |
| 2026-06-16 | Spec model IDs used verbatim (flash-image-preview, pro-image-preview, 2.5-flash-native-audio-preview) | H5 (no silent change); all three confirmed callable against the live API | Dropping `-preview` (docs slugs vary); newer 3.1-flash-live (kept as note) |
| 2026-06-16 | Camera capture via `getUserMedia` → `<canvas>.toBlob()`, not `ImageCapture` | `ImageCapture` is not Baseline (Safari unsupported) | `ImageCapture.takePhoto/grabFrame` |
| 2026-06-16 | Audio via `AudioWorklet` (16k capture / 24k playback) | H3 forbids `ScriptProcessorNode`; SDK doesn't capture mic for you | ScriptProcessorNode (deprecated) |
| 2026-06-16 | Edit history = list + pointer; new edit after revert branches; persisted in IndexedDB | Satisfies "revert to any prior edit and continue" + survives reload; reconciles the spec's undo/redo and click-to-revert phrasings into one coherent model | Destructive truncate on every click (loses redo); no persistence |
| 2026-06-16 | Theming via CSS `light-dark()` + `color-scheme`; manual toggle sets `[data-theme]` | "Both themes are one var-swap"; minimal duplication | Duplicate token blocks for media + attribute |
| 2026-06-16 | Errors surfaced as Popover-API toasts (non-blocking), not inline | Spec UI/UX: clear non-blocking error toasts; platform handles dismiss/focus | Inline error box (blocking-ish, layout shift) |
| 2026-06-16 | Service worker precaches shell, bypasses `/api/*` and non-GET | Installable + offline navigation without ever caching inference traffic or breaking the Live WS | Cache everything (would break API/WS) |
