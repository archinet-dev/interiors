// main.js — wires the UI to state and actions, and renders.
//
// Responsibilities (Pass 0):
//  1. Load the hardcoded sample photo into state on startup.
//  2. Subscribe to state and render the slices this page cares about (image, button, error).
//  3. Wire the button to the editImage action.
//  4. Swap the <img> inside document.startViewTransition() (with a reduced-motion fallback).
//  5. Keep Blob-URL discipline: track the rendered Blob and revoke the prior object URL.

import { getState, setState, subscribe } from "./state.js";
import { runEdit } from "./actions/editImage.js";

const SAMPLE_IMAGE_URL = "assets/sample-room.jpg";
const SAMPLE_PROMPT = "Add a large leafy potted houseplant in the empty corner of the room, matching the existing lighting and perspective.";

// --- DOM references ---
const img = document.getElementById("room-image");
const button = document.getElementById("edit-button");
const errorBox = document.getElementById("error-box");

// --- Blob-URL lifecycle tracking (PROMPT.md: every createObjectURL needs a revoke) ---
let renderedBlob = null; // the Blob currently shown (compare by identity, NOT URL string)
let renderedUrl = null; // its object URL, revoked when replaced

const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

// Render the parts of the DOM that depend on state.
function render(state) {
  // Button reflects editing status.
  button.disabled = state.editingInFlight;
  button.textContent = state.editingInFlight ? "Editing…" : "Try a sample edit";

  // Error region (textContent only — never innerHTML on dynamic strings, constraint H3).
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
    const transition = document.startViewTransition(apply);
    transition.finished.finally(finalize);
  } else {
    apply();
    // Revoke on next frame so the new src has loaded the bytes.
    requestAnimationFrame(finalize);
  }
}

// --- Wire up ---
button.addEventListener("click", () => runEdit(SAMPLE_PROMPT));
subscribe(render);

// --- Startup: load the hardcoded sample photo as a Blob into state ---
async function loadSampleImage() {
  try {
    const res = await fetch(SAMPLE_IMAGE_URL);
    if (!res.ok) throw new Error(`Failed to load sample image (HTTP ${res.status}).`);
    const blob = await res.blob();
    setState({ sourceImage: blob, activeImage: blob });
    console.log("[main] sample image loaded:", blob.type, blob.size, "bytes");
  } catch (err) {
    console.error("[main] could not load sample image:", err);
    setState({ error: err.message || String(err) });
  }
}

loadSampleImage();
