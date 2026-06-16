// actions/editImage.js — the side-effect module for running an image edit.
//
// Per the state/render contract: components never call the API directly. They invoke this
// action, which flips editingInFlight, calls apiClient, and writes the result (or error)
// back through setState. This keeps all async/side-effectful work out of the render path.

import { getState, setState } from "../state.js";
import { editImage as apiEditImage, MODELS } from "../apiClient.js";

// Run an edit against the current activeImage with the given prompt.
// Guards against concurrent edits and a missing image.
export async function runEdit(prompt) {
  const { activeImage, editingInFlight, editingModel } = getState();
  if (editingInFlight) {
    console.warn("[editImage] edit already in flight — ignoring click.");
    return;
  }
  if (!activeImage) {
    setState({ error: "No image loaded to edit yet." });
    return;
  }

  console.log(`[editImage] starting edit (model=${editingModel}):`, prompt);
  setState({ editingInFlight: true, error: null });

  try {
    const model = editingModel === "pro" ? MODELS.pro : MODELS.flash;
    const edited = await apiEditImage(activeImage, prompt, model);
    console.log("[editImage] edit complete:", edited.type, edited.size, "bytes");
    setState({ activeImage: edited, editingInFlight: false });
  } catch (err) {
    // Surface the complete error to the user (per project rule) and clear the in-flight flag.
    console.error("[editImage] edit failed:", err);
    setState({ editingInFlight: false, error: err.message || String(err) });
  }
}
