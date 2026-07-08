// components/reference-tray.js — <reference-tray> "Your items" panel (Pass 6).
//
// Lets the user attach photos of specific things — furniture, decor, tile, wallpaper, fabric —
// to use in the room. Ways in: an "Add item photo" button (file picker, multi-select) or
// drag-and-drop onto the tray. Each attachment renders as a thumbnail with a remove button;
// "Add to room" runs a generic incorporate-edit for everything attached. Attached items also
// ride along with every other edit and are shown to the voice agent (see actions/references.js).
//
// Blob-URL discipline mirrors <edit-history>: one object URL per reference id, revoked when the
// reference is removed and on disconnect.

import { getState, subscribe } from "../state.js";
import { addReference, removeReference, placeReferences, MAX_REFERENCES } from "../actions/references.js";

const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host { display: block; }
  .tray {
    display: flex; flex-direction: column; gap: 10px;
    padding: 12px 14px;
    background: var(--frame, #fff);
    border: 1.5px dashed var(--dash, #b7b7b1);
    border-radius: var(--radius-card, 14px);
  }
  .tray.dragover { border-color: var(--accent, #36c); background: var(--accent-fill, #eef); }
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .title { font: 600 13px/1.2 var(--font-sans, system-ui); color: var(--ink, #2c2c29); margin: 0; }
  .count { font: 600 11px/1 var(--font-mono, monospace); color: var(--soft, #76766f); }
  .hint { color: var(--soft, #76766f); font-size: 12px; margin: 0; }
  .items { display: flex; gap: 8px; flex-wrap: wrap; }
  .items[hidden] { display: none; }
  .item {
    position: relative; width: 64px; height: 64px;
    border: 1px solid var(--line, #d4d4cf); border-radius: 8px; overflow: hidden;
    background: var(--frame, #fff);
  }
  .item img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .remove {
    position: absolute; top: 2px; right: 2px;
    width: 18px; height: 18px; padding: 0; cursor: pointer;
    border: none; border-radius: 50%;
    background: color-mix(in oklch, var(--ink, #2c2c29) 70%, transparent); color: #fff;
    font: 600 11px/18px var(--font-sans, system-ui); text-align: center;
  }
  .controls { display: flex; gap: 8px; flex-wrap: wrap; }
  button.action {
    font: 600 12px/1 var(--font-sans, system-ui);
    border-radius: var(--radius-btn, 8px);
    padding: 9px 14px; cursor: pointer;
    border: 1.5px solid var(--line2, #a0a09a);
    background: var(--frame, #fff); color: var(--ink, #2c2c29);
  }
  button.action.primary {
    color: var(--accent, #36c); background: var(--accent-fill, #eef); border-color: var(--accent, #36c);
  }
  button.action:disabled { opacity: 0.5; cursor: default; }
  button:focus-visible, .remove:focus-visible { outline: 2px solid var(--accent, #36c); outline-offset: 2px; }
  [hidden] { display: none !important; }
`);

class ReferenceTray extends HTMLElement {
  #unsub = null;
  #urls = new Map(); // reference id → object URL
  #renderedKey = null; // ids + in-flight flag, to skip redundant renders
  // Bound handlers (assigned once) so add/removeEventListener use identical references.
  #onClick = null;
  #onFileChange = null;
  #onDragOver = null;
  #onDragLeave = null;
  #onDrop = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.adoptedStyleSheets = [sheet];
    root.innerHTML = `
      <div class="tray" part="tray">
        <div class="head">
          <p class="title">Your items</p>
          <span class="count"></span>
        </div>
        <p class="hint">Have a specific piece in mind? Add a photo of furniture, decor, tile, or wallpaper — then tap “Add to room” or ask the assistant where to put it.</p>
        <div class="items" role="list" aria-label="Attached item photos" hidden></div>
        <div class="controls">
          <button type="button" class="action" data-act="add">＋ Add item photo</button>
          <button type="button" class="action primary" data-act="place" hidden>Add to room</button>
        </div>
        <input type="file" accept="image/*" multiple hidden />
      </div>
    `;

    this.$tray = root.querySelector(".tray");
    this.$count = root.querySelector(".count");
    this.$items = root.querySelector(".items");
    this.$add = root.querySelector('[data-act="add"]');
    this.$place = root.querySelector('[data-act="place"]');
    this.$file = root.querySelector('input[type="file"]');

    this.#onClick = (e) => {
      const remove = e.target.closest?.(".remove");
      if (remove) {
        removeReference(remove.dataset.id);
        return;
      }
      const act = e.target.closest?.("[data-act]")?.dataset.act;
      if (act === "add") this.$file.click();
      else if (act === "place") placeReferences();
    };
    this.#onFileChange = () => {
      for (const file of this.$file.files ?? []) {
        if (!addReference(file)) break; // stop at the first rejection (cap / not an image)
      }
      this.$file.value = ""; // allow re-selecting the same file
    };
    this.#onDragOver = (e) => {
      e.preventDefault();
      this.$tray.classList.add("dragover");
    };
    this.#onDragLeave = () => this.$tray.classList.remove("dragover");
    this.#onDrop = (e) => {
      e.preventDefault();
      this.$tray.classList.remove("dragover");
      for (const file of e.dataTransfer?.files ?? []) {
        if (!addReference(file)) break;
      }
    };
  }

  connectedCallback() {
    this.shadowRoot.addEventListener("click", this.#onClick);
    this.$file.addEventListener("change", this.#onFileChange);
    this.$tray.addEventListener("dragover", this.#onDragOver);
    this.$tray.addEventListener("dragleave", this.#onDragLeave);
    this.$tray.addEventListener("drop", this.#onDrop);
    this.#unsub = subscribe((s) => this.render(s));
    this.render(getState());
  }

  disconnectedCallback() {
    this.shadowRoot.removeEventListener("click", this.#onClick);
    this.$file.removeEventListener("change", this.#onFileChange);
    this.$tray.removeEventListener("dragover", this.#onDragOver);
    this.$tray.removeEventListener("dragleave", this.#onDragLeave);
    this.$tray.removeEventListener("drop", this.#onDrop);
    this.#unsub?.();
    for (const url of this.#urls.values()) URL.revokeObjectURL(url);
    this.#urls.clear();
  }

  render(state) {
    const { referenceImages, editingInFlight } = state;
    const key = referenceImages.map((r) => r.id).join(",") + "|" + editingInFlight;
    if (key === this.#renderedKey) return;
    this.#renderedKey = key;

    // Revoke URLs for references that were removed.
    const liveIds = new Set(referenceImages.map((r) => r.id));
    for (const [id, url] of this.#urls) {
      if (!liveIds.has(id)) {
        URL.revokeObjectURL(url);
        this.#urls.delete(id);
      }
    }

    // Rebuild thumbnails (cheap; reuses cached URLs).
    this.$items.replaceChildren();
    referenceImages.forEach((ref, i) => {
      let url = this.#urls.get(ref.id);
      if (!url) {
        url = URL.createObjectURL(ref.image);
        this.#urls.set(ref.id, url);
      }
      const item = document.createElement("div");
      item.className = "item";
      item.setAttribute("role", "listitem");

      const img = document.createElement("img");
      img.src = url;
      img.alt = `Item photo ${i + 1}`;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove";
      remove.dataset.id = ref.id;
      remove.textContent = "✕";
      remove.disabled = editingInFlight;
      remove.setAttribute("aria-label", `Remove item photo ${i + 1}`);

      item.append(img, remove);
      this.$items.append(item);
    });

    const n = referenceImages.length;
    this.$items.hidden = n === 0;
    this.$count.textContent = n ? `${n}/${MAX_REFERENCES}` : "";
    this.$add.disabled = editingInFlight || n >= MAX_REFERENCES;
    this.$place.hidden = n === 0;
    this.$place.disabled = editingInFlight;
    this.$place.textContent = editingInFlight ? "Editing…" : n > 1 ? "Add items to room" : "Add to room";
  }
}

customElements.define("reference-tray", ReferenceTray);
