// main.js — wires the UI to state and actions, and renders.
//
// Responsibilities:
//  1. Listen for the <camera-capture> `photo` event and adopt the photo (Pass 1).
//  2. Subscribe to state and render the slices this page cares about.
//  3. Toggle between the capture surface and the room view based on whether a photo exists.
//  4. Wire the edit + retake buttons to actions.
//  5. Swap the <img> inside document.startViewTransition() (reduced-motion fallback).
//  6. Keep Blob-URL discipline: track the rendered Blob and revoke the prior object URL.

// Side-effect imports: these modules register custom elements and wire DOM listeners
// at import time. Pulling them in here makes main.js the single module entrypoint
// (consolidated from index.html's separate <script> tags). main.js is a deferred
// module, so it runs after the document is parsed — DOM queries inside them are safe.
import "./components/camera-capture.js";
import "./components/voice-indicator.js";
import "./components/edit-history.js";
import "./components/before-after.js";
import "./components/reference-tray.js";
import "./settings.js";
import "./export.js";
import "./selectionOverlay.js";
import "./realMatches.js";
import "./theme.js";
import "./toast.js";
import "./pwa.js";

import { getState, setState, subscribe } from "./state.js";
import { runEdit } from "./actions/editImage.js";
import { setPhoto } from "./actions/setPhoto.js";
import { stopVoiceSession } from "./actions/voiceSession.js";
import { undo, redo, clearHistory, applyRestoredSession } from "./actions/history.js";
import { clearReferences } from "./actions/references.js";
import { clearSelection } from "./actions/select.js";
import { shareImage } from "./actions/exportImage.js";
import { loadSession } from "./db/idb.js";
import { attachZoomPan } from "./zoomPan.js";

const SAMPLE_PROMPT = "Add a large leafy potted houseplant in the empty corner of the room, matching the existing lighting and perspective.";

// Suggestion chips (wireframe §K) — quick, concrete edits the agent would offer ("two ways in").
const SUGGESTIONS = [
  { label: "Add plants", prompt: "Add a few large potted plants to bring greenery into the room, matching the existing lighting and perspective." },
  { label: "Warmer walls", prompt: "Repaint the walls in a warm, inviting tone that suits the room, keeping the geometry and lighting." },
  { label: "Cozy + modern", prompt: "Restyle the room to feel cozy and modern with updated furniture and soft decor, preserving the layout and perspective." },
  { label: "Declutter", prompt: "Declutter the room — remove clutter and excess objects for a clean, tidy, well-staged look." },
];

// Desktop "three directions" cards (wireframe §K3) — whole-room restyles, richer than the chips.
const DIRECTIONS = [
  { title: "Warm minimal", desc: "Oak tones, fewer objects, soft light.", prompt: "Restyle this room in a warm minimal style — light oak/wood tones, fewer objects, soft natural light — keeping the existing layout and perspective." },
  { title: "Bold & green", desc: "Deep green sofa, lots of plants.", prompt: "Restyle this room boldly — a deep green sofa and lots of leafy plants — keeping the room's geometry and perspective." },
  { title: "Mid-century", desc: "Walnut, brass, warm accents.", prompt: "Restyle this room in mid-century modern style — walnut wood, brass accents, warm tones — keeping the layout and perspective." },
];

// --- DOM references ---
const capture = document.getElementById("capture");
const topbar = document.getElementById("topbar");
const imageView = document.getElementById("image-view");
const voice = document.getElementById("voice");
const directions = document.getElementById("directions");
const dirGrid = document.getElementById("dir-grid");
const suggestions = document.getElementById("suggestions");
const references = document.getElementById("references");
const historyStrip = document.getElementById("history");
const actions = document.getElementById("actions");
const img = document.getElementById("room-image");
const compareView = document.getElementById("compare-view");
const compareButton = document.getElementById("compare-button");
const downloadButton = document.getElementById("download-button");
const shareButton = document.getElementById("share-button");
const proHint = document.getElementById("pro-hint");
const editButton = document.getElementById("edit-button");
const undoButton = document.getElementById("undo-button");
const redoButton = document.getElementById("redo-button");
const retakeButton = document.getElementById("retake-button");
const selectionBar = document.getElementById("selection-bar");
const selectionText = document.getElementById("selection-text");
const selectionClear = document.getElementById("selection-clear");

// Build the suggestion chips once; each runs a concrete edit (disabled while one is in flight).
const chipButtons = SUGGESTIONS.map(({ label, prompt }) => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "chip";
  btn.textContent = label;
  btn.addEventListener("click", () => runEdit(prompt));
  suggestions.append(btn);
  return btn;
});

// Build the desktop direction cards once (title + description); each runs a whole-room restyle.
const directionCards = DIRECTIONS.map(({ title, desc, prompt }) => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "direction";
  const t = document.createElement("span");
  t.className = "dir-title";
  t.textContent = title;
  const d = document.createElement("span");
  d.className = "dir-desc";
  d.textContent = desc;
  btn.append(t, d);
  btn.addEventListener("click", () => runEdit(prompt));
  dirGrid.append(btn);
  return btn;
});

// Pinch-zoom + pan on the active image (mobile gesture; double-click/drag on desktop). The
// transform rides on the wrapper so the tap-to-select overlay (Pass 8) stays aligned.
attachZoomPan(imageView, document.querySelector(".canvas-wrap"), img);

// --- Blob-URL lifecycle tracking (every createObjectURL needs a matching revoke) ---
let renderedBlob = null; // the Blob currently shown (compare by identity, NOT URL string)
let renderedUrl = null; // its object URL, revoked when replaced

const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

// Render the parts of the DOM that depend on state.
function render(state) {
  const hasPhoto = Boolean(state.sourceImage);

  // Toggle capture surface vs. room view. While comparing, show before/after instead of the image.
  const comparing = hasPhoto && state.comparing;
  capture.hidden = hasPhoto;
  topbar.hidden = !hasPhoto;
  imageView.hidden = !hasPhoto || comparing;
  compareView.hidden = !comparing;
  voice.hidden = !hasPhoto;
  directions.hidden = !hasPhoto; // CSS shows this on desktop, chips on mobile
  suggestions.hidden = !hasPhoto;
  references.hidden = !hasPhoto;
  historyStrip.hidden = !hasPhoto;
  actions.hidden = !hasPhoto;

  // Tap-to-select bar (Pass 8): hint → locating → selected chip.
  selectionBar.hidden = !hasPhoto || comparing;
  const sel = state.selection;
  selectionBar.classList.toggle("active", sel?.status === "active");
  selectionText.textContent =
    sel?.status === "active" ? `Selected: ${sel.label} — your next edit changes only this`
    : sel?.status === "locating" ? "Identifying…"
    : "Tap any object in the photo to edit just that";
  selectionClear.hidden = !sel;

  // Compare toggle + Pro hint.
  compareButton.setAttribute("aria-pressed", String(state.comparing));
  compareButton.textContent = state.comparing ? "Exit compare" : "Compare";
  proHint.hidden = !(hasPhoto && state.editingModel === "pro");

  // Edit button reflects editing status.
  editButton.disabled = state.editingInFlight;
  editButton.textContent = state.editingInFlight ? "Editing…" : "Try a sample edit";
  retakeButton.disabled = state.editingInFlight;
  downloadButton.disabled = state.editingInFlight || state.exportBusy;
  shareButton.disabled = state.editingInFlight || state.exportBusy;

  // Suggestion chips + direction cards are disabled while an edit is running.
  for (const chip of chipButtons) chip.disabled = state.editingInFlight;
  for (const card of directionCards) card.disabled = state.editingInFlight;

  // Undo/Redo enablement mirrors the history pointer.
  undoButton.disabled = state.editingInFlight || state.historyIndex <= 0;
  redoButton.disabled = state.editingInFlight || state.historyIndex >= state.history.length - 1;

  // Errors are surfaced as a non-blocking toast (see js/toast.js), not inline.

  // Draft preview badge (Pass 9): a fast Lite draft shows in place while the full render runs.
  const showingDraft = Boolean(state.editingInFlight && state.draftPreview);
  document.getElementById("draft-badge").hidden = !showingDraft;

  // Image swap — only when the displayed Blob actually changed (identity compare). While a
  // targeted edit renders, the Lite draft (if it has landed) previews in place of activeImage.
  const displayBlob = showingDraft ? state.draftPreview : state.activeImage;
  if (displayBlob && displayBlob !== renderedBlob) {
    swapImage(displayBlob);
  } else if (!state.activeImage && renderedUrl) {
    // Photo cleared (retake) — release the rendered URL.
    URL.revokeObjectURL(renderedUrl);
    renderedUrl = null;
    renderedBlob = null;
    img.removeAttribute("src");
  }
}

// Swap the displayed image, animating via View Transitions unless reduced motion is requested.
function swapImage(blob) {
  const nextUrl = URL.createObjectURL(blob);
  const prevUrl = renderedUrl;
  const apply = () => {
    img.src = nextUrl;
  };
  const finalize = () => {
    if (prevUrl) URL.revokeObjectURL(prevUrl); // revoke the OLD url after the swap
  };

  renderedBlob = blob;
  renderedUrl = nextUrl;

  if (document.startViewTransition && !prefersReducedMotion.matches) {
    document.startViewTransition(apply).finished.finally(finalize);
  } else {
    apply();
    requestAnimationFrame(finalize);
  }
}

// --- Wire up ---
// New photo from the capture element → adopt it.
capture.addEventListener("photo", (e) => setPhoto(e.detail.blob));
// Edit the current photo.
editButton.addEventListener("click", () => runEdit(SAMPLE_PROMPT));
// Undo / Redo buttons.
undoButton.addEventListener("click", () => undo());
redoButton.addEventListener("click", () => redo());

// Share the current design instantly (wireframe §L). Download opens the Export dialog with
// shape/size options (Pass 7) — wired in js/export.js.
shareButton.addEventListener("click", () => shareImage());

// Clear the tap selection (✕ button; Esc handled in the keydown listener below).
selectionClear.addEventListener("click", () => clearSelection({ announce: true }));

// Compare toggle — animate the swap via a View Transition (reduced-motion falls back to instant).
compareButton.addEventListener("click", () => {
  const toggle = () => setState({ comparing: !getState().comparing });
  if (document.startViewTransition && !prefersReducedMotion.matches) document.startViewTransition(toggle);
  else toggle();
});

// Retake: stop any voice session, clear the persisted session, and return to the capture surface.
retakeButton.addEventListener("click", () => {
  stopVoiceSession();
  clearHistory();
  clearReferences(); // a new room means new items
  clearSelection(); // and no lingering outline
  setState({ sourceImage: null, activeImage: null, error: null, comparing: false });
});

// Keyboard: Cmd/Ctrl+Z = undo, Shift+Cmd/Ctrl+Z = redo (only when a photo is loaded).
addEventListener("keydown", (e) => {
  // Don't hijack native undo/redo when the user is typing/editing in a form control.
  // composedPath()[0] resolves the real target even across shadow DOM; fall back to e.target.
  const target = e.composedPath?.()[0] ?? e.target;
  const tag = target?.tagName;
  if (target?.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

  // Esc clears the tap selection (Pass 8) — but never while a modal dialog is open (the platform
  // uses Esc to close it).
  if (e.key === "Escape" && getState().selection && !document.querySelector("dialog[open]")) {
    clearSelection({ announce: true });
    return;
  }

  const meta = e.metaKey || e.ctrlKey;
  if (!meta || e.key.toLowerCase() !== "z") return;
  if (!getState().sourceImage || getState().editingInFlight) return;
  e.preventDefault();
  if (e.shiftKey) redo();
  else undo();
});

subscribe(render);

// Restore a persisted session (if any), then initial paint.
loadSession()
  .then((session) => {
    if (applyRestoredSession(session)) console.log("[main] restored session:", session.history.length, "entries");
  })
  .catch((err) => console.warn("[main] could not restore session:", err))
  .finally(() => render(getState()));
