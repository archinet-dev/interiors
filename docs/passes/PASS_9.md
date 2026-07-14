# Pass 9 — Make It Real: Grounded Renders, Real-Matches Rail, Instant Drafts

**Goal ("Make It Real", part two):** every edit can be grounded in things that actually exist.
Flash edits search Google Web + Image Search mid-render and base changes on real products; the
sources appear in a "Real matches" rail under the photo (with Google's required search-suggestions
widget); and targeted edits show a ~4 s Lite draft in place while the full render finishes.

## 1. User stories

- *As a user, when I swap the coffee table, the render is based on a table that's really sold —
  and I can see the sources it referenced.*
- *As a user, I see SOMETHING in seconds: a draft appears while the real render finishes.*
- *As a user, I can turn grounding off in Settings if I just want free-form imagination.*
- *As a user, my real-matches survive a reload along with the rest of my session.*

## 2. Acceptance criteria (all verified live, 2026-07-14)

- [x] Grounded targeted edit (`googleSearch.searchTypes: { webSearch, imageSearch }` on
      `gemini-3.1-flash-image`) returns grounding metadata; the walnut-coffee-table probe surfaced
      3 real West Elm product links + the queries it ran + the 5 KB search-suggestions widget.
- [x] The "Real matches" rail renders source links (DOM-built) and Google's
      `searchEntryPoint.renderedContent` verbatim (ToS requirement; API-provided HTML, documented
      H3 justification in `realMatches.js`), links opening in new tabs.
- [x] Draft preview: on targeted edits a Lite render lands mid-edit (observed 3.6 s) and previews
      in place with a "Draft — refining…" badge; the final replaces it (observed 7.9 s) and the
      draft never records into history. Late drafts can't leak past their edit (settled flag).
- [x] `grounding` persists on history entries — the rail survives reload via the existing
      IndexedDB session (no schema bump).
- [x] Settings gains "Real products" (default on); toggled off, edits record `grounding: null`
      and the rail hides. Pro-model edits skip grounding (Flash-only capability).
- [x] Edits with nothing to shop for simply come back ungrounded — no empty rail.

## 3. Design findings (live-verified)

- **`search_types` is a nested message, not a list**: the REST/docs-cited flat list 400s; the
  correct shape (from the SDK's own types, then live-verified) is
  `tools: [{ googleSearch: { searchTypes: { webSearch: {}, imageSearch: {} } } }]`.
- **Grounding is model-discretionary**: identical config with a neutral prompt returned no
  metadata; grounded requests therefore append an explicit search nudge scoped to
  furniture/decor/paint/materials.
- **Chunk variance**: the same request sometimes returns source links, sometimes only queries +
  the suggestions widget. The rail renders whatever came back; the widget is the constant.

## 4. Risk register

| Risk | Mitigation | Outcome |
|------|------------|---------|
| R1: Grounding adds latency/cost to every edit | Flash-only, discretionary searches, default-on but one-tap off in Settings | Grounded edits ~8-12 s vs ~7-8 s ungrounded |
| R2: Draft/final race (slow draft lands after final) | `editSettled` flag + in-flight check before showing; draft cleared with the final in the same batch | No stray draft frames observed |
| R3: renderedContent is third-party HTML | Rendered verbatim per ToS in an isolated container; links forced `target=_blank rel=noopener`; it is API-provided (not user-controlled) so H3 holds | Widget renders correctly, light + dark |

## 5. File manifest

| File | Change | Why |
|------|--------|-----|
| `js/apiClient.js` | modified | `MODELS.lite`; `editImage` returns `{image, grounding}` with grounded tools + search nudge; `extractGrounding()` |
| `js/actions/editImage.js` | modified | Lite draft fire-and-forget for targeted edits; grounded flag; records grounding |
| `js/actions/history.js` | modified | `recordEdit(prompt, blob, grounding)` — persisted per entry |
| `js/realMatches.js` | **added** | Real-matches rail renderer (links + required suggestions widget) |
| `js/state.js` | modified | `groundedEdits`, `draftPreview` (flat keys) |
| `js/settings.js` | modified | "Real products" toggle wiring |
| `js/main.js` | modified | Draft-in-place display + badge; realMatches import |
| `index.html` | modified | Rail section, draft badge, settings toggle |
| `styles.css` | modified | `--real`/`--real-fill` tokens; rail, link chips, draft badge |
| `sw.js` | modified | Precache realMatches.js; bump shell cache to v8 |
| `docs/passes/PASS_9.md` | added | This report |
| `README.md` | modified | Capability ledger entry |

## 6. Notes & carried forward

- Grounded results don't include purchasable checkout links — the rail is sources + the Google
  suggestions surface (that's the documented ceiling for third-party apps today).
- Draft renders are Lite-only and never grounded (speed is their whole job).
- The reference-image count cap remains unmeasured (the 14/10 claim was refuted in research) —
  the tray's 4-item cap stays well under any plausible limit.
