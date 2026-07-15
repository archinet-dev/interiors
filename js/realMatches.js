// realMatches.js — the "Real matches" rail (Pass 9): for a grounded edit, show the real-world
// sources the render referenced and Google's search-suggestions chip.
//
// ToS note: when grounded results are displayed, Google REQUIRES showing the returned
// searchEntryPoint.renderedContent as-is. That HTML comes from the Gemini API through our own
// key proxy — it is API-provided, not user-controlled, so assigning it via innerHTML does not
// violate constraint H3 (no innerHTML on USER-controlled strings). It renders in its own
// container and links open in new tabs.

import { getState, subscribe } from "./state.js";

const section = document.getElementById("real-matches");
const linksBox = document.getElementById("rm-links");
const suggestionsBox = document.getElementById("rm-suggestions");

let renderedEntryId = null; // skip re-rendering the same entry on unrelated state changes

function render(state) {
  const entry = state.history[state.historyIndex];
  const g = entry?.grounding;
  const show = Boolean(state.sourceImage && g && (g.chunks.length || g.renderedContent));
  section.hidden = !show;
  if (!show) {
    renderedEntryId = null;
    return;
  }
  if (entry.id === renderedEntryId) return;

  // Source links — built via DOM APIs (titles/uris are API data; still never innerHTML'd).
  // Each chunk is fenced: one malformed URI must not abort the shared subscribe loop or leave
  // the rail half-built (renderedEntryId is only stamped after a successful full render).
  linksBox.textContent = "";
  for (const c of g.chunks.slice(0, 6)) {
    try {
      const a = document.createElement("a");
      a.className = "rm-link";
      a.href = c.uri;
      a.target = "_blank";
      a.rel = "noopener";
      let label = c.title;
      if (!label) {
        try { label = new URL(c.uri).hostname; } catch { label = c.uri; }
      }
      a.textContent = label;
      linksBox.append(a);
    } catch (err) {
      console.warn("[realMatches] skipped malformed source chunk:", err?.message ?? err);
    }
  }

  // Google's required search-suggestions widget, verbatim (see ToS note above).
  suggestionsBox.innerHTML = g.renderedContent || "";
  for (const a of suggestionsBox.querySelectorAll("a")) {
    a.target = "_blank";
    a.rel = "noopener";
  }
  renderedEntryId = entry.id;
}

subscribe(render);
render(getState());
