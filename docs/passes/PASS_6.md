# Pass 6 — Reference Items

**Capability:** "Use *this* exact piece" — the user attaches photos of specific objects, furniture,
tiles, wallpaper, or other materials, and the app works them into the room: via a one-tap
"Add to room" edit, or by asking the voice agent where to put them.

## (a) Acceptance Criteria
```
[ ] A "Your items" tray appears once a room photo exists (hidden before). It offers "Add item
    photo" (file picker, multi-select) and drag-and-drop.
[ ] Each attached item renders as a thumbnail with a remove (✕) button; a count shows n/4.
[ ] Non-image files are rejected with a toast; the cap (4) is enforced with a toast and the
    add button disables at the cap.
[ ] "Add to room" runs an edit that incorporates the attached item(s)/material(s); the button
    shows an in-flight state and all edit affordances disable while it runs.
[ ] While items are attached, EVERY edit (sample button, chips/directions, voice tool call)
    sends the room image plus each reference image with framing text; with no items attached
    the payload is unchanged (1 text + 1 image).
[ ] The voice agent is briefed: attached items are sent as visual context on session start and
    immediately when attached mid-session; the system instruction explains how to use them.
[ ] Items persist with the session (IndexedDB) — a reload restores the tray; "New photo" clears it.
[ ] Blob-URL discipline: one object URL per item, revoked on removal and on disconnect.
[ ] Keyboard path works (tray buttons are native, focus visible); no console errors; every new
    file reachable (H4).
```

## (b) Risk Register
```
R1. The model edits the wrong image (returns a reference instead of the room) or forces an
    attached item into unrelated edits. Mitigation: framing text names image roles explicitly
    ("first image is the current room… always return the edited ROOM image") and scopes use to
    "when the instruction refers to such an item"; references ride along but are ignored otherwise.
R2. Payload bloat — references are re-uploaded with every edit. Mitigation: hard cap of 4
    attachments (enforced in the action with a user-visible toast).
R3. Restored sessions predate this pass (no referenceImages key). Mitigation:
    applyRestoredSession defaults to [] (`session.referenceImages ?? []`); ids are
    crypto.randomUUID() so restored items can never collide with new ones.
```

## (c) File Manifest
| File | Add/Mod | Justification |
|------|---------|---------------|
| `js/state.js` | mod | New flat key `referenceImages: []` (`[{ id, image: Blob, ts }]`). |
| `js/apiClient.js` | mod | `editImage()` accepts optional reference Blobs; appends them after the room image with framing text. |
| `js/actions/editImage.js` | mod | `runEdit` passes attached references from state into every edit. |
| `js/actions/references.js` | add | add/remove/clear/place actions; type + cap validation; persists; briefs a live voice session. |
| `js/components/reference-tray.js` | add | `<reference-tray>` — add button, drag-drop, thumbnails with remove, "Add to room", per-id Blob-URL lifecycle. |
| `js/actions/history.js` | mod | Session persistence now includes `referenceImages`; exported `persistSession()`; restore defaults the key. |
| `js/actions/voiceSession.js` | mod | System-instruction paragraph on reference items; sends them as context on start; new `sendReferenceContext()`. |
| `js/main.js` | mod | Imports the component; toggles tray visibility; "New photo" clears references. |
| `index.html` | mod | `<reference-tray id="references">` between suggestions and the filmstrip. |
| `styles.css` | mod | `#references` joins the full-width workspace group. |
| `sw.js` | mod | Precache the two new modules (cache bumped to `smv-shell-v5`) so the offline shell's module graph stays intact. |
| `docs/manual.html` | mod | New "Add your own items" section + TOC entry. |
| `README.md` | mod | Capability ledger entry for Pass 6. |

## Pass Report

**Verified in-browser on 2026-07-08** (Playwright against the Bun server; the Gemini SDK was
stubbed at the import-map URL because this sandbox's network policy blocks esm.sh — payload
shape was captured from the stub, UI/state/persistence exercised for real).

### 1. Capability added
A reference-items tray: attach up to 4 photos of specific furniture, decor, tile, or wallpaper;
add them to the room with one tap or by voice; attachments ride along with every edit and are
shown to the live agent; the tray survives a reload and clears on "New photo".

### 2. Files touched
See the manifest above — 2 files added (`js/actions/references.js`,
`js/components/reference-tray.js`), 8 modified.

### 3. Acceptance criteria — pass/fail
```
[x] Tray hidden before a photo, visible after; add button + drag-drop both attach. (verified)
[x] Thumbnails with ✕; count reads n/4. (verified: 2/4 → remove → 1/4)
[x] Non-image rejected via toast; cap enforced via toast ("up to 4 item photos"); add button
    disabled at the cap; a 5th attempt adds nothing. (verified)
[x] "Add to room" flips to "Editing…", disables edit affordances, re-enables on completion;
    failures surface as the standard error toast. (verified via stubbed rejection)
[x] Payload shape (captured from the SDK stub): no items → 1 text + 1 image, no framing;
    with 2 items → 1 text + 3 images (room jpeg first, then both refs), framing text present —
    for both the tray button and a suggestion/direction edit. (verified)
[~] Voice: reference context on session start + on mid-session attach, system instruction
    updated — code-verified; live-audio behavior needs the manual mic/speaker pass like Pass 2.
[x] Reload restores the tray from IndexedDB (1 item survived); "New photo" empties it. (verified)
[x] Blob-URL discipline: per-id URL map, revoked on removal/disconnect (mirrors <edit-history>).
[x] Keyboard: native buttons, focus-visible; shadow activeElement lands on "Add item photo".
[x] No unexpected console errors; both new files are reachable from js/main.js (H4). (verified)
```

### 4. Decisions made
- **References ride along with every edit** rather than only "place" edits — one predictable
  rule for both tap and voice paths; the framing text scopes their use to instructions that
  refer to them (R1). The voice agent is told they're auto-included so its tool prompts can
  just say "the armchair from the reference photo".
- **One generic "Add to room" prompt** covers both placeable things (furniture, decor) and
  surface materials (tile, wallpaper, paint, fabric) — the model decides place-vs-apply.
- **Cap of 4 attachments** (R2) with a visible count; `crypto.randomUUID()` ids (no counter to
  restore, no collision risk with persisted sessions).
- **Persistence reuses the single session record** (`{ history, historyIndex, referenceImages }`)
  — no new store, no DB version bump; pre-Pass-6 records restore cleanly (R3).
- **Tray styling mirrors the capture surface** (dashed border, same tokens through the shadow
  boundary) to read as "another place you can drop a photo".

### 5. Risks carried forward / manual checks
- ~~**Edit fidelity with real models**~~ — **verified 2026-07-10 against the live API** (local,
  key in `.env`, Playwright-driven): a generated photo of a distinctive red mid-century armchair
  was attached and "Add to room" reproduced that exact chair — color, style, wooden legs — in the
  room's empty corner at realistic scale with matching lighting; geometry preserved, history
  appended, no console errors.
- ~~**Live voice with attachments**~~ — **verified 2026-07-10 against the live API**: a real
  Live session (WS through the Bun proxy) confirmed "I see the room and the reference photo",
  tool-called `editImage("move the red armchair from the reference photo next to the sofa by
  the window")`, ran the real edit, received the updated image, and narrated the result. Only
  the physical microphone was shimmed (silent synthetic stream; request injected as a text turn
  via the `sendUserText` test hook) — spoken audio in/out remains the standing Pass 2 mic check.
  Fidelity nuance observed: on a "move" instruction the model *added* the chair at the new spot
  rather than relocating the original ("add" is more reliable than "move"); app behavior was
  correct and undo/a follow-up edit resolves it.
- Budgets: no new long tasks on the main thread (reads are async FileReader; thumbnails are
  object URLs); heap discipline covered by the per-id revoke pattern.

### 6. Capability ledger
Updated in `README.md`.
