# Pass 7 — Export Controls: Aspect Ratio + Upscale

**Goal:** give the user control over the exported image's shape and size. Exports default to the
original aspect ratio (the exact current image, zero API calls). Choosing a new shape **extends**
the room's scene generatively to fill the new canvas (outpaint — never crop or stretch); choosing
2K/4K upscales via the Pro model. The result can optionally be kept in the edit history.

## 1. Pre-code verification (live API, 2026-07-13)

Probed `generationConfig.imageConfig` on both preview models with the sample room (1408×768,
ratio 1.833) — REST directly, then through the pinned `@google/genai@2.8.0` to prove the SDK
passes `config.imageConfig` through:

| Call | Result |
|------|--------|
| flash + `aspectRatio: "16:9"` | 1376×768 (1.792) in 8.7s ✔ |
| flash + `aspectRatio: "9:16"` | 768×1376 (0.558) in 9.5s ✔ |
| pro + `16:9` + `imageSize: "2K"` | 2752×1536 in 21.1s ✔ |
| pro + `imageSize: "4K"`, **no aspectRatio** | 6336×2688 — ratio drifted 1.833 → **2.357** ⚠ |
| SDK 2.8.0 `config.imageConfig` | passed through — 1376×768 ✔ |

**Key finding:** omitting `aspectRatio` lets the model drift the shape, so "Original" upscales
must send the **nearest supported ratio** explicitly (`nearestSupportedRatio()` in apiClient.js).
Supported set: 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9.

## 2. Acceptance criteria (all verified in-browser, live API)

- [x] ↧ Download opens an Export dialog (native `<dialog>`: modality, focus trap, Esc all platform-handled).
- [x] Defaults are **Original / Standard**; exporting with them downloads the exact current image
      instantly with **no API call** (verified: 0.0s, byte dims identical to source).
- [x] Picking 16:9 renders a generative expansion (8.3s live): same room, scene seamlessly
      continued, nothing cropped/stretched; **history unchanged** when "keep" is off.
- [x] Picking 4:5 + 2K renders via Pro (23.4s live): 1856×2304 (ratio 0.806 ≈ 4:5, 2K-class).
- [x] "Keep the result in my edit history" appends an undoable entry ("Expanded to 4:5 · 2K");
      undo returns to the original; the entry **persists across reload** via IndexedDB.
- [x] Share in the dialog uses the Web Share API where available, falling back to download
      (same `deliverShare` path as the topbar Share).
- [x] Esc closes the dialog; controls disable while rendering ("Rendering…"); topbar
      Download/Share disabled while `exportBusy` or `editingInFlight`.
- [x] Zero console errors across the whole flow; every object URL created for delivery is revoked.

## 3. Risk register

| Risk | Mitigation | Outcome |
|------|------------|---------|
| R1: SDK pin (2.8.0) might strip `config.imageConfig` | Probe through the SDK itself before writing app code | Passed — no pin bump needed |
| R2: Model returns a different shape than requested (drift) | Always send explicit `aspectRatio`; after render, verify achieved ratio and toast a heads-up if >5% off | Renders landed on-ratio (grid-rounded, e.g. 1.792 for 16:9) |
| R3: 2K/4K blobs bloat memory/history | Result enters history only on explicit opt-in; delivery URLs revoked after download kicks off | Heap steady in test run |

## 4. File manifest

| File | Change | Why |
|------|--------|-----|
| `index.html` | modified | Export dialog markup (native `<dialog>`, radios as toggle chips, keep-in-history checkbox) |
| `js/export.js` | **added** | Dialog wiring: opens from ↧ Download, mirrors `exportBusy`, runs the action |
| `js/actions/exportImage.js` | modified | `exportImage({ratio,size,share,keepInHistory})` orchestration; `deliverDownload`/`deliverShare` refactor |
| `js/apiClient.js` | modified | `renderForExport()` (imageConfig), `SUPPORTED_RATIOS`, `nearestSupportedRatio()`, shared response parser |
| `js/state.js` | modified | `exportBusy` flag (flat, prefixed key) |
| `js/main.js` | modified | imports export.js; Download button hands off to the dialog; busy-state disables |
| `styles.css` | modified | Dialog + chip-radio styles on existing tokens; `::backdrop` |
| `sw.js` | modified | Precache `js/export.js`; bump shell cache to v6 |
| `docs/passes/PASS_7.md` | added | This report |
| `README.md` | modified | Capability ledger entry |

## 5. Notes & carried forward

- Model output ratios are grid-rounded (16:9 → 1.792, not 1.778); the R2 runtime check tolerates
  5% before warning. Exact-pixel canvas sizes are not controllable via the API.
- "Original" + 2K/4K upscales render at the *nearest supported* ratio (surfaced in the dialog
  copy); for the sample room that means 1.833 → 16:9.
- Voice-driven export ("export this as a square") is a possible future slice — the tool-call
  bridge could register `exportImage` alongside `editImage`.
