// components/edit-history.js — <edit-history> horizontal filmstrip.
//
// Shows one thumbnail per history entry, oldest → newest; the active entry is ringed. Clicking a
// thumbnail reverts to it (jumpTo). Manages one object URL per entry id and revokes URLs for entries
// that are no longer present, so there's no Blob-URL leak as history grows/branches.

import { getState, subscribe } from "../state.js";
import { jumpTo } from "../actions/history.js";

const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host { display: block; }
  .strip {
    display: flex; gap: 8px; overflow-x: auto; padding: 4px;
    scroll-snap-type: x proximity;
  }
  .strip:empty::after { content: ""; }
  button.thumb {
    flex: 0 0 auto; width: 64px; height: 48px; padding: 0; cursor: pointer;
    border: 2px solid var(--line, #d4d4cf); border-radius: 8px; overflow: hidden;
    background: var(--frame, #fff); scroll-snap-align: start; position: relative;
  }
  button.thumb[aria-current="true"] { border-color: var(--accent, #36c); }
  button.thumb:focus-visible { outline: 2px solid var(--accent, #36c); outline-offset: 2px; }
  button.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .badge {
    position: absolute; left: 2px; top: 2px; font: 600 9px/1 var(--font-mono, monospace);
    background: color-mix(in oklch, var(--ink, #2c2c29) 70%, transparent); color: #fff;
    padding: 2px 4px; border-radius: 4px;
  }
`);

class EditHistory extends HTMLElement {
  #unsub = null;
  #urls = new Map(); // entry.id → object URL
  #renderedKey = ""; // history ids + index, to skip redundant renders

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.adoptedStyleSheets = [sheet];
    const strip = document.createElement("div");
    strip.className = "strip";
    strip.setAttribute("role", "listbox");
    strip.setAttribute("aria-label", "Edit history");
    root.append(strip);
    this.$strip = strip;

    // Event delegation: click a thumbnail → revert.
    strip.addEventListener("click", (e) => {
      const btn = e.target.closest("button.thumb");
      if (btn) jumpTo(Number(btn.dataset.index));
    });
  }

  connectedCallback() {
    this.#unsub = subscribe((s) => this.render(s));
    this.render(getState());
  }

  disconnectedCallback() {
    this.#unsub?.();
    for (const url of this.#urls.values()) URL.revokeObjectURL(url);
    this.#urls.clear();
  }

  render(state) {
    const { history, historyIndex } = state;
    const key = history.map((e) => e.id).join(",") + "|" + historyIndex;
    if (key === this.#renderedKey) return; // nothing relevant changed
    this.#renderedKey = key;

    // Revoke URLs for entries that no longer exist (branch truncation, reset).
    const liveIds = new Set(history.map((e) => e.id));
    for (const [id, url] of this.#urls) {
      if (!liveIds.has(id)) {
        URL.revokeObjectURL(url);
        this.#urls.delete(id);
      }
    }

    // Rebuild thumbnails (cheap; reuses cached URLs).
    this.$strip.replaceChildren();
    history.forEach((entry, index) => {
      let url = this.#urls.get(entry.id);
      if (!url) {
        url = URL.createObjectURL(entry.image);
        this.#urls.set(entry.id, url);
      }
      const btn = document.createElement("button");
      btn.className = "thumb";
      btn.type = "button";
      btn.dataset.index = String(index);
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-current", String(index === historyIndex));
      btn.title = entry.prompt;
      btn.setAttribute("aria-label", index === 0 ? "Original photo" : `Edit ${index}: ${entry.prompt}`);

      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      btn.append(img);

      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = index === 0 ? "★" : String(index);
      btn.append(badge);

      this.$strip.append(btn);
    });

    // Keep the active thumbnail in view.
    const active = this.$strip.children[historyIndex];
    active?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }
}

customElements.define("edit-history", EditHistory);
