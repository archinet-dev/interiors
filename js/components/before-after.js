// components/before-after.js — <before-after> comparison slider.
//
// Layers the ORIGINAL (history[0]) under the CURRENT (activeImage) in one container and reveals the
// current image up to a draggable divider via clip-path. The divider is a keyboard-accessible slider
// (role=slider, arrow keys). Subscribes to state for both images and manages their object URLs.

import { getState, subscribe } from "../state.js";

const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host { display: block; }
  .wrap {
    position: relative; width: 100%; overflow: hidden; touch-action: none;
    border: 1px solid var(--line, #d4d4cf); border-radius: var(--radius-card, 14px);
    background: #000; aspect-ratio: 1408 / 768;
  }
  img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; user-select: none; -webkit-user-drag: none; }
  .after { clip-path: inset(0 calc(100% - var(--split, 50%)) 0 0); }
  .divider {
    position: absolute; top: 0; bottom: 0; left: var(--split, 50%);
    width: 2px; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.3); transform: translateX(-1px);
    cursor: ew-resize;
  }
  .handle {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 32px; height: 32px; border-radius: 50%; background: #fff; color: #2c2c29;
    display: grid; place-items: center; font-size: 14px; box-shadow: 0 1px 4px rgba(0,0,0,.35);
  }
  .label {
    position: absolute; top: 8px; font: 600 10px/1 var(--font-mono, monospace);
    text-transform: uppercase; letter-spacing: .08em; color: #fff;
    background: rgba(0,0,0,.45); padding: 4px 6px; border-radius: 4px;
  }
  .label.before { left: 8px; } .label.after { right: 8px; }
  .divider:focus-visible { outline: 2px solid var(--accent, #36c); outline-offset: 2px; }
`);

class BeforeAfter extends HTMLElement {
  #unsub = null;
  #urls = { before: null, after: null };
  #blobs = { before: null, after: null };
  #split = 50;
  #dragging = false;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.adoptedStyleSheets = [sheet];
    const wrap = document.createElement("div");
    wrap.className = "wrap";
    wrap.innerHTML = `
      <img class="before" alt="Original room">
      <img class="after" alt="Edited room">
      <span class="label before">Before</span>
      <span class="label after">After</span>
      <div class="divider" tabindex="0" role="slider" aria-label="Reveal edited image"
           aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">
        <span class="handle">⇆</span>
      </div>`;
    root.append(wrap);
    this.$wrap = wrap;
    this.$before = wrap.querySelector(".before");
    this.$after = wrap.querySelector(".after");
    this.$divider = wrap.querySelector(".divider");
  }

  connectedCallback() {
    // Pointer drag to move the divider.
    const onMove = (clientX) => {
      const rect = this.$wrap.getBoundingClientRect();
      const pct = ((clientX - rect.left) / rect.width) * 100;
      this.#setSplit(pct);
    };
    this.$wrap.addEventListener("pointerdown", (e) => {
      this.#dragging = true;
      this.$wrap.setPointerCapture(e.pointerId);
      onMove(e.clientX);
    });
    this.$wrap.addEventListener("pointermove", (e) => { if (this.#dragging) onMove(e.clientX); });
    this.$wrap.addEventListener("pointerup", (e) => {
      this.#dragging = false;
      try { this.$wrap.releasePointerCapture(e.pointerId); } catch {}
    });
    // Keyboard accessibility on the divider.
    this.$divider.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") { this.#setSplit(this.#split - 4); e.preventDefault(); }
      else if (e.key === "ArrowRight") { this.#setSplit(this.#split + 4); e.preventDefault(); }
      else if (e.key === "Home") { this.#setSplit(0); e.preventDefault(); }
      else if (e.key === "End") { this.#setSplit(100); e.preventDefault(); }
    });

    this.#unsub = subscribe((s) => this.render(s));
    this.render(getState());
  }

  disconnectedCallback() {
    this.#unsub?.();
    this.#revoke("before");
    this.#revoke("after");
  }

  #setSplit(pct) {
    this.#split = Math.max(0, Math.min(100, pct));
    this.$wrap.style.setProperty("--split", `${this.#split}%`);
    this.$divider.setAttribute("aria-valuenow", String(Math.round(this.#split)));
  }

  render(state) {
    const before = state.history[0]?.image || state.sourceImage;
    const after = state.activeImage;
    this.#updateImage("before", before, this.$before);
    this.#updateImage("after", after, this.$after);
  }

  // Swap an <img>'s blob URL only when the underlying Blob changed (identity compare).
  #updateImage(slot, blob, el) {
    if (!blob || blob === this.#blobs[slot]) return;
    this.#revoke(slot);
    const url = URL.createObjectURL(blob);
    this.#urls[slot] = url;
    this.#blobs[slot] = blob;
    el.src = url;
    if (slot === "after") {
      // Match the container aspect-ratio to the image to avoid distortion/layout shift.
      el.onload = () => {
        if (el.naturalWidth) this.$wrap.style.aspectRatio = `${el.naturalWidth} / ${el.naturalHeight}`;
      };
    }
  }

  #revoke(slot) {
    if (this.#urls[slot]) {
      URL.revokeObjectURL(this.#urls[slot]);
      this.#urls[slot] = null;
      this.#blobs[slot] = null;
    }
  }
}

customElements.define("before-after", BeforeAfter);
