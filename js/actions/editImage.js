// actions/editImage.js — the side-effect module for running an image edit.
//
// Per the state/render contract: components never call the API directly. They invoke this
// action, which flips editingInFlight, calls apiClient, and writes the result (or error)
// back through setState. This keeps all async/side-effectful work out of the render path.

import { getState, setState } from "../state.js";
import { editImage as apiEditImage, MODELS } from "../apiClient.js";
import { recordEdit } from "./history.js";
import { clearSelection } from "./select.js";

// Run an edit against the current activeImage with the given prompt.
// Guards against concurrent edits and a missing image. Returns true on success, false otherwise
// (so the voice tool-call handler can report the outcome back to the Live agent).
// Pass 8: when an object is selected (state.selection active), the edit is scoped to it and the
// selection is cleared once the edit lands.
export async function runEdit(prompt) {
  const { activeImage, editingInFlight, editingModel, referenceImages, selection } = getState();
  if (editingInFlight) {
    console.warn("[editImage] edit already in flight — ignoring request.");
    return false;
  }
  if (!activeImage) {
    setState({ error: "No image loaded to edit yet." });
    return false;
  }

  console.log(`[editImage] starting edit (model=${editingModel}):`, prompt);
  setState({ editingInFlight: true, error: null });

  try {
    const model = editingModel === "pro" ? MODELS.pro : MODELS.flash;
    // Attached reference items (Pass 6) ride along with EVERY edit — the framing text in
    // apiClient tells the model to use them only when the instruction refers to them.
    const references = referenceImages.map((r) => r.image);
    const target = selection?.status === "active" ? { label: selection.label, box: selection.box } : null;
    const edited = await apiEditImage(activeImage, prompt, model, references, target);
    console.log("[editImage] edit complete:", edited.type, edited.size, "bytes");
    // recordEdit sets activeImage + history; clear the in-flight flag in the SAME synchronous
    // run (batched into one render) so there's never a frame with the flag off but the old image.
    recordEdit(target ? `${target.label} — ${prompt}` : prompt, edited);
    if (target) clearSelection(); // the object was changed; its outline no longer applies
    setState({ editingInFlight: false });
    return true;
  } catch (err) {
    // Surface the complete error to the user (per project rule) and clear the in-flight flag.
    console.error("[editImage] edit failed:", err);
    setState({ editingInFlight: false, error: err.message || String(err) });
    return false;
  }
}
