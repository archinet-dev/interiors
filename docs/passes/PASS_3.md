# Pass 3 — Edit History + Undo/Redo

**Capability:** "User can revert to any prior edit and continue from there — and a refresh doesn't
wipe the session."

## (a) Acceptance Criteria
```
[ ] Setting a photo seeds history with the original as entry 0; a filmstrip thumbnail appears.
[ ] Each successful edit (button OR voice) appends a thumbnail; the active one is ringed.
[ ] Clicking a thumbnail reverts activeImage to that entry.
[ ] Making a new edit after reverting branches (truncates forward history), then appends.
[ ] Cmd/Ctrl+Z undoes; Shift+Cmd/Ctrl+Z redoes; Undo/Redo buttons mirror this and disable at ends.
[ ] History persists in IndexedDB: after a full page reload the filmstrip + active image are restored.
[ ] "New photo" clears the persisted session and resets history.
[ ] Blob-URL discipline: thumbnail URLs are revoked when entries are removed (no leak).
[ ] No console errors; every new file reachable from index.html / its modules.
```

## (b) Risk Register
```
R1. Storing Blobs in IndexedDB / restoring them. Mitigation: IndexedDB structured-clones Blobs
    natively; persist the whole {history, historyIndex} record under one key; restore on load.
R2. Thumbnail object-URL leak across many edits. Mitigation: <edit-history> caches one URL per
    entry id and revokes URLs for entries no longer present on each render.
R3. Undo/redo vs. click-to-revert model conflict. Mitigation: one model — history + pointer; undo/
    redo move the pointer; a NEW edit while not at the end truncates forward then appends (branch).
    Clicking a thumbnail moves the pointer (revert). Documented in the report.
```

## (c) File Manifest
| File | Add/Mod | Justification |
|------|---------|---------------|
| `js/db/idb.js` | add | ~40-line promise wrapper over IndexedDB (no library): save/load/clear one session record. |
| `js/actions/history.js` | add | `recordEdit`, `undo`, `redo`, `jumpTo`, `resetHistory`, `restoreSession` — all mutate history+pointer+activeImage and persist. |
| `js/components/edit-history.js` | add | `<edit-history>` filmstrip element; thumbnails with per-id URL caching; click → jumpTo. |
| `js/actions/setPhoto.js` | mod | Seed history with the original as entry 0 (via resetHistory) and persist. |
| `js/actions/editImage.js` | mod | On success, append via `recordEdit` instead of setting activeImage directly. |
| `js/state.js` | mod | Add `historyIndex`. |
| `js/main.js` | mod | Restore session on load; keyboard undo/redo; wire Undo/Redo buttons; toggle filmstrip; clear session on retake. |
| `index.html` | mod | `<edit-history>` + Undo/Redo buttons + script. |
| `styles.css` | mod | Filmstrip + undo/redo button layout. |

## Pass Report

**Verified in-browser on 2026-06-16** (Playwright against the Bun server).

### 1. Capability added
Every edit is recorded in a persisted history filmstrip; the user can undo/redo, click any thumbnail
to revert, branch by editing from a past point, and a full reload restores the whole session.

### 2. Files touched
`js/db/idb.js` (IndexedDB wrapper), `js/actions/history.js` (history model), `js/components/edit-history.js`
(filmstrip), `js/actions/setPhoto.js` (seed history), `js/actions/editImage.js` (record on success),
`js/state.js` (`historyIndex`), `js/main.js` (restore, keyboard, undo/redo, toggle, clear-on-retake),
`index.html` (filmstrip + undo/redo buttons + script), `styles.css` (widths).

### 3. Acceptance criteria — pass/fail
```
[x] Setting a photo seeds history with the original (entry 0); a thumbnail appears.
[x] Each successful edit (button or voice) appends a thumbnail; active one is ringed.
[x] Clicking a thumbnail reverts activeImage (jumpTo verified; ring follows).
[x] Editing after a revert branches: length stayed 2 (truncate forward + append), index 1, active=latest.
[x] Cmd/Ctrl+Z undo / Shift+Cmd/Ctrl+Z redo; Undo/Redo buttons mirror + disable at the ends. (undo/redo verified)
[x] History persists in IndexedDB: after a full reload, 2 entries + pointer + active image restored.
[x] "New photo" clears the persisted session (loadSession→undefined) and resets to capture.
[x] Blob-URL discipline: filmstrip caches one URL per id, revokes removed ones.
[x] No console errors; all new files reachable.
```

### 4. Decisions made
- **One history model** reconciling the spec's two phrasings: history + pointer; undo/redo move the
  pointer (non-destructive), a NEW edit while not at the end truncates forward then appends (branch),
  clicking a thumbnail moves the pointer (revert). Satisfies "revert to any prior edit and continue."
- **Persist the whole `{history, historyIndex}` record under one IndexedDB key** (Blobs structured-clone
  natively) — simplest correct approach at this scale.
- **Added Undo/Redo buttons** (beyond the required keyboard shortcuts) for discoverability + a11y.

### 5. Risks carried forward
- **Unbounded history growth** in IndexedDB over a very long session (many large Blobs) — could add a
  cap/eviction later; not required by the spec.
- **Budgets** (Lighthouse a11y ≥95, 4G first paint, 50-edit memory) to be measured in Pass 5.

### 6. Capability ledger
Updated in `README.md` (Pass 3 section).
