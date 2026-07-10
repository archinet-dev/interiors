// state.js — the single source of truth: a ~30-line pub/sub store.
//
// CONTRACT (from PROMPT.md "STATE & RENDER CONTRACT"):
//  - State is FLAT. No nesting beyond one level. Extend with prefixed top-level keys
//    (voiceStatus, voiceTranscript), never nested objects.
//  - getState() returns a FROZEN snapshot (mutating it throws in strict mode).
//  - setState(partial) does a SHALLOW merge of top-level keys, then notifies.
//  - subscribe(fn) returns an unsubscribe function.
//  - Notifications are BATCHED with requestAnimationFrame: many setState calls in one
//    frame coalesce into a single render.
//
// No component mutates state directly — all changes go through setState; all side effects
// live in actions/* modules.

// The canonical flat shape. Later passes extend this with more prefixed keys.
const INITIAL_STATE = {
  sourceImage: null, // Blob — the original captured/sample photo
  activeImage: null, // Blob — the current (possibly edited) image
  history: [], // [{ id, prompt, image: Blob, ts }] — edit history (Pass 3)
  historyIndex: -1, // pointer into history; activeImage mirrors history[historyIndex] (Pass 3)
  voiceStatus: "idle", // 'idle' | 'listening' | 'thinking' | 'speaking' (Pass 2)
  voiceActive: false, // true while a Live voice session is open (Pass 2)
  voiceTranscript: [], // input + output captions — [{ role, text, ts }] (Pass 2)
  editingInFlight: false, // true while an image edit is running
  editingModel: "flash", // 'flash' | 'pro' — model selection (Pass 4)
  referenceImages: [], // [{ id, image: Blob, ts }] — item/material photos to use in edits (Pass 6)
  comparing: false, // true while the before/after view is shown (Pass 4)
  error: null, // string | null — last user-visible error
};

let state = Object.freeze({ ...INITIAL_STATE });
const subscribers = new Set();
let pendingFrame = 0;

// Return the current frozen snapshot. Callers must not mutate it.
export function getState() {
  return state;
}

// Shallow-merge top-level keys, refreeze, then schedule a batched notify.
export function setState(partial) {
  state = Object.freeze({ ...state, ...partial });
  scheduleNotify();
}

// Subscribe to state changes; returns an unsubscribe function.
export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// Coalesce multiple setState calls within the same animation frame into one render pass.
function scheduleNotify() {
  if (pendingFrame) return;
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = 0;
    const snapshot = state;
    for (const fn of subscribers) fn(snapshot);
  });
}
