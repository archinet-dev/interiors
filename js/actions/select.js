// actions/select.js — tap-to-select an object in the room (Pass 8).
//
// The user taps the photo (or the voice agent names an object); we ask the vision model to
// locate it and store the result in state.selection. While a lookup runs, selection holds
// { status: 'locating' } so the UI can show progress; a successful lookup flips it to
// { status: 'active', label, box, polygon }. Edits read the active selection and scope
// themselves to it (see actions/editImage.js).

import { getState, setState } from "../state.js";
import { locateObject } from "../apiClient.js";

let generation = 0; // invalidates in-flight lookups when a newer tap/clear lands

// Select whatever object is at the tapped point (y, x normalized to 0-1000). Announces the
// result to a live voice session so the agent knows what "this" now means.
export async function selectAtPoint(y, x) {
  const sel = await runLocate({ point: [Math.round(y), Math.round(x)] });
  if (sel) {
    // Dynamic import: voiceSession imports this module, so a static import would be a cycle.
    import("./voiceSession.js").then((m) => m.announceSelection(sel.label)).catch(() => {});
  }
  return sel;
}

// Select an object by natural-language description (voice path: "the grey sofa"). No announce —
// this path is driven BY the agent, which already knows the target.
export async function selectByQuery(query) {
  return runLocate({ query });
}

// options.announce: user-initiated clears (✕ / Esc / double-tap) tell the live agent; programmatic
// clears (edit landed, image swapped) stay silent.
export function clearSelection({ announce = false } = {}) {
  generation++;
  const had = Boolean(getState().selection);
  if (had) setState({ selection: null });
  if (had && announce) {
    import("./voiceSession.js").then((m) => m.announceSelectionCleared()).catch(() => {});
  }
}

// Shared lookup driver. Returns the selection on success, null otherwise.
async function runLocate(what) {
  const { activeImage } = getState();
  if (!activeImage) return null;

  const myGen = ++generation;
  setState({ selection: { status: "locating", label: null, box: null, polygon: null } });
  try {
    const found = await locateObject(activeImage, what);
    if (myGen !== generation) return null; // superseded by a newer tap or a clear
    if (!found) {
      setState({ selection: null, error: "Couldn't identify anything there — try tapping the object itself." });
      return null;
    }
    const selection = { status: "active", ...found };
    setState({ selection });
    return selection;
  } catch (err) {
    console.error("[select] locate failed:", err);
    if (myGen === generation) {
      setState({ selection: null, error: `Selection failed: ${err?.message ?? err}` });
    }
    return null;
  }
}
