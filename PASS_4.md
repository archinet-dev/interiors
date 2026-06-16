# Pass 4 — Before/After + High-Quality Render

**Capability:** "User compares the original vs the current image, and can opt into a higher-quality
Pro render."

## (a) Acceptance Criteria
```
[ ] A "Compare" toggle shows a <before-after> view (original vs current) with a draggable divider.
[ ] Dragging the divider reveals more/less of the edited image; keyboard arrows move it (a11y slider).
[ ] Toggling compare on/off animates via a View Transition (reduced-motion: no animation).
[ ] A Settings popover (Popover API) offers a Flash/Pro model choice; selecting it sets editingModel.
[ ] When Pro is selected, the UI briefly surfaces the cost/quality tradeoff ("Pro · up to 4K, slower").
[ ] A Pro edit actually runs against gemini-3-pro-image-preview and returns an image (verified once).
[ ] No console errors; every new file reachable from index.html / its modules.
```

## (b) Risk Register
```
R1. before/after image alignment / layout shift across varying aspect ratios. Mitigation: both layers
    are object-fit:cover in one container whose aspect-ratio is set from the loaded image; reveal via
    clip-path inset driven by a single --split var.
R2. Pro model slower/heavier or unavailable. Mitigation: model id is a verified constant in apiClient;
    surface "slower" in the UI; the editingInFlight state already keeps the UI non-blocking. Verify one
    real Pro edit.
R3. Popover focus/dismiss a11y. Mitigation: use the native Popover API (declarative popovertarget) so
    the platform handles light-dismiss, Esc, and focus — no hand-rolled JS.
```

## (c) File Manifest
| File | Add/Mod | Justification |
|------|---------|---------------|
| `js/components/before-after.js` | add | `<before-after>` element: layered before/current images, draggable + keyboard-accessible divider; subscribes to state (original vs activeImage). |
| `js/settings.js` | add | Wire the native Settings popover's Flash/Pro radios to `setState({ editingModel })`. |
| `js/state.js` | mod | Add `comparing` flag. |
| `index.html` | mod | Compare toggle, Settings button + `[popover]` panel, `<before-after>` element, scripts. |
| `js/main.js` | mod | Compare toggle (View Transition), render before-after vs image, Pro hint near the edit button. |
| `styles.css` | mod | Compare/settings layout + Pro hint. |

## Pass Report

**Verified in-browser on 2026-06-16** (Playwright against the Bun server, real Gemini API).

### 1. Capability added
A Compare toggle reveals a draggable before/after of original vs current, and a Settings popover lets
the user opt into a higher-quality Pro render.

### 2. Files touched
`js/components/before-after.js` (slider element), `js/settings.js` (popover↔state), `js/state.js`
(`comparing`), `index.html` (compare/settings buttons, `[popover]` panel, `<before-after>`, scripts),
`js/main.js` (compare toggle via View Transition, before-after vs image, Pro hint), `styles.css`.

### 3. Acceptance criteria — pass/fail
```
[x] "Compare" shows <before-after> (original vs current) with a draggable divider; "Exit compare" returns.
[x] Divider drags (pointer) and moves via arrow keys (role=slider; aria-valuenow 50→42 on 2×←); Home/End jump.
[x] Compare toggle wrapped in document.startViewTransition() (reduced-motion → instant).
[x] Settings popover (native Popover API) offers Flash/Pro; selecting Pro sets editingModel='pro'.
[x] Pro selected → "Pro render selected — higher quality, up to 4K, a little slower." hint shows.
[x] A Pro edit ran against gemini-3-pro-image-preview → 200 (3.1MB vs ~2MB Flash — higher quality).
[x] No console errors; all new files reachable.
```

### 4. Decisions made
- **Compare is a full-view toggle** (not an overlay) so the divider gets the full canvas; reveal via a
  single `--split` clip-path on the "after" layer; container aspect-ratio set from the loaded image.
- **Native Popover API** (declarative `popovertarget`) for Settings so the platform handles
  light-dismiss / Esc / focus (R3) — no hand-rolled menu JS.
- **Model selection persists in state** (`editingModel`) and applies to BOTH button and voice edits;
  the Pro tradeoff is surfaced as a hint whenever Pro is active ("opt-in, surfaced briefly").

### 5. Risks carried forward
- **Budgets** (Lighthouse a11y ≥95, 4G first paint, 50-edit memory) — measure in Pass 5.
- **Manual checks** still outstanding: real camera (Pass 1) and live audio I/O (Pass 2).

### 6. Capability ledger
Updated in `README.md` (Pass 4 section).
