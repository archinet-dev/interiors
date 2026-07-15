// actions/editImage.js — the side-effect module for running an image edit.
//
// Per the state/render contract: components never call the API directly. They invoke this
// action, which flips editingInFlight, calls apiClient, and writes the result (or error)
// back through setState. This keeps all async/side-effectful work out of the render path.
//
// Pass 8: when an object is selected (state.selection active), the edit is scoped to it and the
// selection is cleared once the edit lands.
// Pass 9: targeted edits fire a ~4 s Lite DRAFT that previews in place while the full render
// finishes, and Flash edits are grounded in Google Web + Image Search (state.groundedEdits) so
// the change references real products; the grounding sources ride into the history entry.

import { getState, setState } from "../state.js";
import { editImage as apiEditImage, MODELS } from "../apiClient.js";
import { recordEdit } from "./history.js";
import { clearSelection } from "./select.js";

// Run an edit against the current activeImage with the given prompt.
// Guards against concurrent edits and a missing image. Returns true on success, false otherwise
// (so the voice tool-call handler can report the outcome back to the Live agent).
export async function runEdit(prompt) {
  const { activeImage, editingInFlight, editingModel, referenceImages, selection, groundedEdits } = getState();
  if (editingInFlight) {
    console.warn("[editImage] edit already in flight — ignoring request.");
    return false;
  }
  if (!activeImage) {
    setState({ error: "No image loaded to edit yet." });
    return false;
  }

  console.log(`[editImage] starting edit (model=${editingModel}, grounded=${groundedEdits}):`, prompt);
  setState({ editingInFlight: true, error: null });

  // Attached reference items (Pass 6) ride along with EVERY edit — the framing text in
  // apiClient tells the model to use them only when the instruction refers to them.
  const references = referenceImages.map((r) => r.image);
  const target = selection?.status === "active" ? { label: selection.label, box: selection.box } : null;

  // Draft preview (Pass 9, targeted edits only): a cheap 1K Lite render lands in ~4 s and shows
  // in place while the full render finishes. Fire-and-forget; failures are non-fatal. The
  // `draftDone` flag stops a late draft from leaking past this edit's lifetime.
  let editSettled = false;
  if (target) {
    apiEditImage(activeImage, prompt, MODELS.lite, references, target)
      .then(({ image }) => {
        // Show the draft only if THIS edit is still running AND the user hasn't navigated
        // history away from the image the draft was rendered from.
        if (!editSettled && getState().editingInFlight && getState().activeImage === activeImage) {
          setState({ draftPreview: image });
        }
      })
      .catch((err) => console.warn("[editImage] draft render failed (non-fatal):", err?.message ?? err));
  }

  try {
    const model = editingModel === "pro" ? MODELS.pro : MODELS.flash;
    const { image, grounding } = await apiEditImage(activeImage, prompt, model, references, target, {
      grounded: groundedEdits,
    });
    console.log("[editImage] edit complete:", image.type, image.size, "bytes",
      grounding ? `(grounded: ${grounding.chunks.length} sources)` : "");
    // recordEdit sets activeImage + history; clear the in-flight flag in the SAME synchronous
    // run (batched into one render) so there's never a frame with the flag off but the old image.
    recordEdit(target ? `${target.label} — ${prompt}` : prompt, image, grounding);
    setState({ editingInFlight: false, draftPreview: null });
    if (target) clearSelection(); // the object was changed; its outline no longer applies
    return true;
  } catch (err) {
    // Surface the complete error to the user (per project rule) and clear the in-flight flag.
    console.error("[editImage] edit failed:", err);
    setState({ editingInFlight: false, draftPreview: null, error: err.message || String(err) });
    return false;
  } finally {
    editSettled = true;
  }
}
