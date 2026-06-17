// actions/setPhoto.js — side-effect action for adopting a new source photo.
//
// Keeps state writes out of the <camera-capture> component (which only dispatches a `photo`
// event). Setting a fresh source resets the active image to it and clears any prior error.

import { setState } from "../state.js";
import { resetHistory } from "./history.js";

// Adopt a captured/uploaded/sample Blob as both the original and the current image,
// and seed the edit history with it as entry 0 (persisted to IndexedDB).
export function setPhoto(blob) {
  console.log("[setPhoto] new source photo:", blob.type, blob.size, "bytes");
  setState({ sourceImage: blob, error: null });
  resetHistory(blob); // sets activeImage + history[0] + persists
}
