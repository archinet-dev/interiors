// selectionOverlay.js — draws the selected object's outline over the room image and turns taps
// on the photo into selections (Pass 8).
//
// The <svg> lives inside .canvas-wrap next to the <img>, so the zoom/pan transform (applied to
// the wrapper by zoomPan.js) moves both together. Because the image renders with
// `object-fit: cover`, the element box is NOT the picture: the SVG is sized/positioned to the
// visible CONTENT box (computed from layout + natural size, both transform-independent) and uses
// a 0-1000 viewBox with preserveAspectRatio="none" so vision-model coordinates map 1:1.
// Tap detection: pointerdown→pointerup with <8px movement and <500ms; drags, pinches, and
// double-click zooms are ignored (a dblclick clears the selection instead).

import { getState, subscribe } from "./state.js";
import { selectAtPoint, clearSelection } from "./actions/select.js";

// Tap listeners live on the figure (#image-view): zoomPan sets pointer capture on it, which
// retargets pointerup there — a listener on the inner wrapper would never hear the tap's end.
const surface = document.getElementById("image-view");
const img = document.getElementById("room-image");
const svg = document.getElementById("selection-overlay");
const SVGNS = "http://www.w3.org/2000/svg";

// --- keep the SVG glued to the VISIBLE image content (object-fit: cover crops) ---
function placeOverlay() {
  const ew = img.offsetWidth;
  const eh = img.offsetHeight;
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!ew || !eh || !nw || !nh) return;
  const s = Math.max(ew / nw, eh / nh); // cover scale
  const w = nw * s;
  const h = nh * s;
  svg.style.width = `${w}px`;
  svg.style.height = `${h}px`;
  svg.style.left = `${(ew - w) / 2}px`;
  svg.style.top = `${(eh - h) / 2}px`;
}
new ResizeObserver(placeOverlay).observe(img);
img.addEventListener("load", placeOverlay);

// --- render the outline from state ---
let shape = null; // current SVG path element

function render(state) {
  const sel = state.selection;
  svg.classList.toggle("locating", sel?.status === "locating");
  if (!sel || sel.status !== "active") {
    if (shape) { shape.remove(); shape = null; }
    return;
  }
  const d = sel.polygon
    ? "M" + sel.polygon.map(([y, x]) => `${x},${y}`).join(" L") + " Z"
    : roundedBoxPath(sel.box);
  if (!shape) {
    shape = document.createElementNS(SVGNS, "path");
    shape.setAttribute("class", "selection-shape");
    svg.appendChild(shape);
  }
  shape.setAttribute("d", d);
  placeOverlay();
}

// A box outline with cut corners reads as "region", not "error rectangle".
function roundedBoxPath([ymin, xmin, ymax, xmax]) {
  const r = Math.min(24, (ymax - ymin) / 4, (xmax - xmin) / 4);
  return `M${xmin + r},${ymin} L${xmax - r},${ymin} L${xmax},${ymin + r} L${xmax},${ymax - r} L${xmax - r},${ymax} L${xmin + r},${ymax} L${xmin},${ymax - r} L${xmin},${ymin + r} Z`;
}

subscribe(render);
render(getState());

// --- tap → select ---
let down = null; // { x, y, t, id }

surface.addEventListener("pointerdown", (e) => {
  if (e.isPrimary) down = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
});

surface.addEventListener("pointerup", (e) => {
  const d = down;
  down = null;
  if (!d || e.pointerId !== d.id) return;
  if (Date.now() - d.t > 500) return; // long press / slow drag
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) return; // drag or pan
  if (getState().editingInFlight) return; // don't retarget mid-edit

  // Normalize against the overlay's on-screen rect — it IS the visible picture (content box),
  // and getBoundingClientRect reflects any zoom/pan transform.
  const r = svg.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const x = ((e.clientX - r.left) / r.width) * 1000;
  const y = ((e.clientY - r.top) / r.height) * 1000;
  if (x < 0 || x > 1000 || y < 0 || y > 1000) return;
  selectAtPoint(y, x);
});

// Double-click is the zoom-toggle gesture — treat it as "not a selection" and clear.
surface.addEventListener("dblclick", () => clearSelection({ announce: true }));

// A new photo or an edit swap invalidates the old outline's coordinates. (Programmatic clear —
// runEdit already cleared targeted edits; this catches undo/redo/filmstrip swaps.)
img.addEventListener("load", () => {
  if (getState().selection) clearSelection();
});
