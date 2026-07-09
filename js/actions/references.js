// actions/references.js — side-effect module for "reference items" (Pass 6).
//
// A reference is a user-supplied photo of a specific thing — a piece of furniture, an objet,
// tile, wallpaper, fabric — that they want added to the room or applied to it. References live
// in state.referenceImages ([{ id, image: Blob, ts }]); while attached they are sent with every
// edit (see actions/editImage.js) and shared with the live voice agent as visual context, so
// "add the armchair from my photo by the window" works in both modalities.

import { getState, setState } from "../state.js";
import { runEdit } from "./editImage.js";
import { persistSession } from "./history.js";
import { sendReferenceContext } from "./voiceSession.js";

// Keep the payload sane: each reference is re-uploaded with every edit, so cap the count.
export const MAX_REFERENCES = 4;

// The generic "use everything I attached" edit, for the tray's Add-to-room button. Covers both
// placeable things (furniture, decor) and surface materials (tile, wallpaper, paint, fabric).
const PLACE_PROMPT =
  "Incorporate the item(s) or material(s) shown in the reference photo(s) into the room in the most natural way: place furniture, decor, or objects in a suitable spot at a realistic scale; apply materials such as tile, wallpaper, paint, or fabric to the appropriate surfaces. Match the room's lighting, perspective, and style.";

// Attach a reference photo. Validates type + cap, persists, and briefs an active voice session.
export function addReference(blob) {
  if (!blob?.type?.startsWith("image/")) {
    setState({ error: "That file isn't an image. Please choose a JPEG or PNG." });
    return false;
  }
  const { referenceImages } = getState();
  if (referenceImages.length >= MAX_REFERENCES) {
    setState({ error: `You can attach up to ${MAX_REFERENCES} item photos — remove one first.` });
    return false;
  }
  // Deliberately do NOT clear state.error here: in a multi-file batch a rejected file's error
  // and a later file's success coalesce into one render, and clearing would eat the toast.
  const entry = { id: crypto.randomUUID(), image: blob, ts: Date.now() };
  setState({ referenceImages: [...referenceImages, entry] });
  persistSession();
  // If a voice session is live, show the agent what the user just attached (fire-and-forget).
  // The whole entry is passed so voiceSession can dedupe by id against its own startup send.
  sendReferenceContext(entry).catch((err) => console.warn("[references] voice context failed:", err));
  console.log("[references] attached:", blob.type, blob.size, "bytes");
  return true;
}

export function removeReference(id) {
  const { referenceImages } = getState();
  const next = referenceImages.filter((r) => r.id !== id);
  if (next.length === referenceImages.length) return;
  setState({ referenceImages: next });
  persistSession();
}

// Drop all references (called on "New photo" — a new room means new items).
export function clearReferences() {
  if (getState().referenceImages.length) setState({ referenceImages: [] });
}

// Run the generic incorporate-edit for everything currently attached (tray button).
export function placeReferences() {
  if (!getState().referenceImages.length) return Promise.resolve(false);
  return runEdit(PLACE_PROMPT);
}
