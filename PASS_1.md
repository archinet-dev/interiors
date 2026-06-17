# Pass 1 — Real Camera / Upload

**Capability:** "User captures or uploads their own photo, then runs the same hardcoded edit on it."

Replaces Pass 0's auto-loaded sample as the *only* source: the app now opens to a capture surface
(camera, file upload, drag-and-drop, or the bundled sample for quick testing). The captured/uploaded
Blob becomes `sourceImage` + `activeImage`, and the existing edit button now edits the user's photo.

## (a) Acceptance Criteria
```
[ ] App opens to a capture UI (no auto-loaded photo). No console errors.
[ ] "Upload" accepts an image file → it appears in the card; edit button becomes available.
[ ] Drag-and-drop an image onto the drop zone → same result.
[ ] "Use sample" loads the bundled room photo (keyboard-reachable; deterministic for testing).
[ ] "Use camera" requests getUserMedia; on a device with a camera, a live preview + Capture
    appear; Capture freezes a frame into a Blob via <canvas> (NOT ImageCapture — Risk R1).
[ ] Camera permission DENIED (or no device) → upload UI remains, a clear message shows,
    and there is NO uncaught console error.
[ ] After a photo is set, clicking "Try a sample edit" edits THAT photo (not the old sample).
[ ] "Retake / new photo" returns to the capture UI.
[ ] Keyboard-only: every control is reachable and operable; focus is visible.
[ ] Blob discipline holds — replacing the source revokes the prior rendered URL (no leak).
[ ] Every new file is reachable from index.html / a module it loads.
```

## (b) Risk Register
```
R1. ImageCapture is not Baseline (Safari unsupported) — verified in the pre-code report.
    Mitigation: capture frames with getUserMedia → <video> → <canvas>.toBlob(). Never call
    ImageCapture.
R2. Camera permission denial / no device throws and freezes the UI or logs an error.
    Mitigation: wrap getUserMedia in try/catch; on failure set a friendly message and keep the
    upload + sample paths working. Stop any started tracks on disconnect/retake (no leaked stream).
R3. A non-image file (or huge file) is dropped/selected → broken edit downstream.
    Mitigation: validate file.type starts with "image/"; reject others with a message. Always stop
    the camera stream when leaving the capture view.
```

## (c) File Manifest
| File | Add/Mod | Justification |
|------|---------|---------------|
| `js/components/camera-capture.js` | add | `<camera-capture>` custom element (Shadow DOM): camera preview + canvas capture, file upload, drag-and-drop, "use sample"; emits a `photo` event with the Blob. |
| `js/actions/setPhoto.js` | add | Side-effect action: takes a Blob, sets `sourceImage`+`activeImage` via setState, clears error. Keeps writes out of the component. |
| `index.html` | mod | Register/include `<camera-capture>`; the image card + edit button now toggle with capture state. |
| `js/main.js` | mod | Stop auto-loading the sample; listen for the `photo` event → setPhoto; render toggles capture vs. image+edit; add "Retake". |
| `styles.css` | mod | Capture-surface layout + show/hide of capture vs. image views. |

## Pass Report

**Verified in-browser on 2026-06-16** (Playwright against the Bun server).

### 1. Capability added
The app opens to a capture surface; a photo from camera / upload / drag-drop / sample becomes the
source, and the edit button now edits the user's own photo.

### 2. Files touched
`js/components/camera-capture.js` (new element), `js/actions/setPhoto.js` (new action),
`index.html` (capture element + toggled image/actions), `js/main.js` (photo event, capture↔image
toggle, retake), `styles.css` (capture layout, `.actions`, secondary button, global `[hidden]` reset).

### 3. Acceptance criteria — pass/fail
```
[x] Opens to capture UI, no auto-loaded photo, no console errors.
[x] Upload accepts an image → appears in card; actions appear. (verified via file drop)
[x] Drag-and-drop an image → same result. (verified)
[x] "Use sample" loads the bundled photo; keyboard-reachable. (verified)
[~] "Use camera" → getUserMedia: in headless test the prompt is pending (no device). The success
    path (video preview → canvas capture) is code-verified; needs a manual test on a real camera.
[x] Camera permission DENIED → message shown, upload/sample still work, NO uncaught error. (forced
    NotAllowedError; verified)
[x] After a photo is set, edit edits THAT photo (proxy 200, new image bytes differ from sample).
[x] "New photo" returns to the capture UI. (verified)
[x] Keyboard: controls are buttons with visible :focus-visible outlines.
[x] Blob discipline: source replace/clear revokes the prior URL (retake path clears src).
[x] All new files reachable from index.html / its modules.
```

### 4. Decisions made
- **Kept the bundled sample as a "Use sample" button** (not auto-loaded). Gives a deterministic,
  camera-free path for testing/demo while satisfying "user provides the photo."
- **Capture logic lives in the element; state writes go through `setPhoto`** (component dispatches a
  `photo` event; it never calls setState itself).
- **`<canvas>.toBlob()` for capture, never `ImageCapture`** (R1 — not Baseline in Safari).
- **Global `[hidden] { display:none !important }`** so the attribute beats `.actions{display:flex}`
  and a custom element's `:host{display:block}`.

### 5. Risks carried forward
- **Real-camera capture path** not exercised under automation (no device) — manual verification
  needed; code follows the verified canvas approach.
- **Pass 2 WebSocket-through-Bun-proxy** for the Live API remains the headline risk (spike first).
- **Budgets** (Lighthouse a11y ≥95, 4G first paint) still to be measured.

### 6. Capability ledger
Updated in `README.md` (Pass 1 section).
