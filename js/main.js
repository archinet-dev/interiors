// main.js — wires the UI to state and actions, and renders.
//
// Responsibilities:
//  1. Listen for the <camera-capture> `photo` event and adopt the photo (Pass 1).
//  2. Subscribe to state and render the slices this page cares about.
//  3. Toggle between the capture surface and the room view based on whether a photo exists.
//  4. Wire the edit + retake buttons to actions.
//  5. Swap the <img> inside document.startViewTransition() (reduced-motion fallback).
//  6. Keep Blob-URL discipline: track the rendered Blob and revoke the prior object URL.

import { getState, setState, subscribe } from "./state.js";
import { runEdit } from "./actions/editImage.js";
import { setPhoto } from "./actions/setPhoto.js";
import { stopVoiceSession } from "./actions/voiceSession.js";
import { undo, redo, clearHistory, applyRestoredSession } from "./actions/history.js";
import { loadSession } from "./db/idb.js";

const SAMPLE_PROMPT = "Add a large leafy potted houseplant in the empty corner of the room, matching the existing lighting and perspective.";

// --- DOM references ---
const capture = document.getElementById("capture");
const imageView = document.getElementById("image-view");
const voice = document.getElementById("voice");
const historyStrip = document.getElementById("history");
const actions = document.getElementById("actions");
const img = document.getElementById("room-image");
const compareView = document.getElementById("compare-view");
const compareButton = document.getElementById("compare-button");
const proHint = document.getElementById("pro-hint");
const editButton = document.getElementById("edit-button");
const undoButton = document.getElementById("undo-button");
const redoButton = document.getElementById("redo-button");
const retakeButton = document.getElementById("retake-button");

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
  imageView.hidden = !hasPhoto || comparing;
  compareView.hidden = !comparing;
  voice.hidden = !hasPhoto;
  historyStrip.hidden = !hasPhoto;
  actions.hidden = !hasPhoto;

  // Compare toggle + Pro hint.
  compareButton.setAttribute("aria-pressed", String(state.comparing));
  compareButton.textContent = state.comparing ? "Exit compare" : "Compare";
  proHint.hidden = !(hasPhoto && state.editingModel === "pro");

  // Edit button reflects editing status.
  editButton.disabled = state.editingInFlight;
  editButton.textContent = state.editingInFlight ? "Editing…" : "Try a sample edit";
  retakeButton.disabled = state.editingInFlight;

  // Undo/Redo enablement mirrors the history pointer.
  undoButton.disabled = state.editingInFlight || state.historyIndex <= 0;
  redoButton.disabled = state.editingInFlight || state.historyIndex >= state.history.length - 1;

  // Errors are surfaced as a non-blocking toast (see js/toast.js), not inline.

  // Image swap — only when the active Blob actually changed (identity compare).
  if (state.activeImage && state.activeImage !== renderedBlob) {
    swapImage(state.activeImage);
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
  setState({ sourceImage: null, activeImage: null, error: null, comparing: false });
});

// Keyboard: Cmd/Ctrl+Z = undo, Shift+Cmd/Ctrl+Z = redo (only when a photo is loaded).
addEventListener("keydown", (e) => {
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
