# Pass 8 — Touch the Room: Tap-to-Select Targeted Edits

**Goal ("Make It Real", part one):** the room stops being one repaintable picture and becomes a
set of objects. Tap anything (or name it out loud) → the vision model locates it → a glowing
outline confirms it → the next edit changes exactly that object and nothing else.

## 0. Prerequisite shipped in this pass

Image model IDs migrated from the deprecated `-preview` IDs to the stable GA IDs
(`gemini-3.1-flash-image`, `gemini-3-pro-image`), each live-verified on 2026-07-14 before the
switch. Segmentation/locating routes to **`gemini-3.5-flash`** (`MODELS.vision`) because the
official docs state pixel masks are *not supported* on the Gemini 3 image models.

## 1. User stories

- *As a user, I tap the sofa and see it outlined with its name, so I know exactly what will change.*
- *As a user, with the sofa selected, my next edit — button, chip, or voice — changes only the sofa.*
- *As a user, I say "make just the coffee table walnut" without tapping; the agent finds it,
  outlines it for me, and edits only it.*
- *As a user, I can dismiss a selection (✕, Esc, or double-tap) and go back to whole-room edits.*

## 2. Acceptance criteria (all verified live, 2026-07-14)

- [x] Tapping the photo shows "Identifying…", then an outline + "Selected: {label}" chip.
      Verified: tap on sofa → `the sectional sofa`, box `[512,236,815,674]`, 17-vertex polygon
      drawn as marching-ants SVG (~2-3 s round trip).
- [x] With a selection active, `runEdit` scopes the edit: "Make it a deep emerald green velvet"
      recolored ONLY the sofa (cushions, throw, rug, table, lamp pixel-faithful), 8 s via
      `gemini-3.1-flash-image`. History entry reads `the sectional sofa — Make it…`.
- [x] Selection clears automatically once the targeted edit lands (and on undo/redo/filmstrip
      swaps via the image `load` listener).
- [x] Voice: the Live agent's `editImage` tool gained an optional `target` argument. Live session
      test: agent called `editImage("change the round coffee table to walnut wood", target:
      "the round coffee table")` → locate → outline → scoped edit → history 3 → agent narrated.
      A user's explicit tap selection always wins over the agent's wording.
- [x] The agent is told about tap selections/clears (`announceSelection*` context turns).
- [x] ✕ button and Esc clear the selection (Esc yields to open modal dialogs); double-click
      (the zoom gesture) clears rather than selects; drags/pinches never select (8 px / 500 ms
      tap discrimination, pointer-capture-aware — listeners live on the figure).
- [x] Outline stays glued to the photo under zoom/pan (transform moved to a shared wrapper) and
      maps correctly under `object-fit: cover` (overlay sized to the visible content box).
- [x] Zero unexplained console errors across the flow; the one malformed-JSON vision response
      observed was absorbed by the salvage parser (fences/truncation tolerated, friendly
      "couldn't identify" retry message otherwise).

## 3. Risk register

| Risk | Mitigation | Outcome |
|------|------------|---------|
| R1: Vision model JSON is loosely shaped (polygon formats varied in probing) | `box_2d` is the contract; polygon is best-effort with a cut-corner box fallback; salvage parser for fences/truncation | Hit once in testing; absorbed |
| R2: Tap vs. zoom/pan gesture conflicts | 8 px / 500 ms tap discrimination; dblclick = clear; listeners on the pointer-capture target | No mis-selects in testing |
| R3: Region-scoped prompts could still bleed edits outside the box | Scoping text demands everything outside stays EXACTLY unchanged; before/after compare makes bleed visible; undo is one tap | Emerald-sofa test showed no visible bleed |

## 4. File manifest

| File | Change | Why |
|------|--------|-----|
| `js/apiClient.js` | modified | Stable model IDs + `MODELS.vision`; `locateObject()` (point/query → label+box+polygon, salvage parser); `editImage()` scoping via `target` |
| `js/actions/select.js` | **added** | selectAtPoint / selectByQuery / clearSelection actions with generation guard + agent announcements |
| `js/selectionOverlay.js` | **added** | SVG outline renderer (content-box aware) + tap detection on the zoom surface |
| `js/actions/editImage.js` | modified | Reads active selection → targeted edit; labels history; clears selection on success |
| `js/actions/voiceSession.js` | modified | `target` tool param, system-instruction update, locate-before-edit, selection announcements |
| `js/state.js` | modified | `selection` key (flat) |
| `js/zoomPan.js` | modified | Transform target split from load-reset image (wrapper carries transform) |
| `js/main.js` | modified | Overlay import, wrapper zoomPan, selection bar render, ✕/Esc clear, retake clears selection |
| `index.html` | modified | `.canvas-wrap` + `#selection-overlay` SVG + selection bar |
| `styles.css` | modified | `--select`/`--select-fill` tokens, outline + marching ants (reduced-motion aware), selection bar |
| `sw.js` | modified | Precache new modules; bump shell cache to v7 |
| `docs/passes/PASS_8.md` | added | This report |
| `README.md` | modified | Capability ledger entry |

## 5. Notes & carried forward

- Locate calls add ~2-3 s before a targeted edit from voice; the outline appearing during the
  agent's speech makes the wait feel intentional. Pass 9's ~4 s Lite drafts will layer on this.
- The selection is coordinate-bound to the CURRENT image; any image swap invalidates it by design.
- Segmentation accuracy is documented capability, not benchmarked: ambiguous taps (e.g. rug edge
  vs floor) occasionally return nothing — the friendly retry message covers it.
