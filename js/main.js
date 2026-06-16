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

const SAMPLE_PROMPT = "Add a large leafy potted houseplant in the empty corner of the room, matching the existing lighting and perspective.";

// --- DOM references ---
const capture = document.getElementById("capture");
const imageView = document.getElementById("image-view");
const actions = document.getElementById("actions");
const img = document.getElementById("room-image");
const editButton = document.getElementById("edit-button");
const retakeButton = document.getElementById("retake-button");
const errorBox = document.getElementById("error-box");

// --- Blob-URL lifecycle tracking (every createObjectURL needs a matching revoke) ---
let renderedBlob = null; // the Blob currently shown (compare by identity, NOT URL string)
let renderedUrl = null; // its object URL, revoked when replaced

const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

// Render the parts of the DOM that depend on state.
function render(state) {
  const hasPhoto = Boolean(state.sourceImage);

  // Toggle capture surface vs. room view.
  capture.hidden = hasPhoto;
  imageView.hidden = !hasPhoto;
  actions.hidden = !hasPhoto;

  // Edit button reflects editing status.
  editButton.disabled = state.editingInFlight;
  editButton.textContent = state.editingInFlight ? "Editing…" : "Try a sample edit";
  retakeButton.disabled = state.editingInFlight;

  // Error region (textContent only — never innerHTML on dynamic strings, H3).
  if (state.error) {
    errorBox.textContent = state.error;
    errorBox.hidden = false;
  } else {
    errorBox.textContent = "";
    errorBox.hidden = true;
  }

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
// Retake: clear the photo to return to the capture surface.
retakeButton.addEventListener("click", () => setState({ sourceImage: null, activeImage: null, error: null }));

subscribe(render);

// Initial paint (capture surface; no photo yet).
render(getState());
