// actions/history.js — the edit-history model: a list + a pointer.
//
// Model (one coherent scheme):
//  - history: [{ id, prompt, image: Blob, ts }], oldest → newest. Entry 0 is the original photo.
//  - historyIndex: the currently-active entry. activeImage always mirrors history[historyIndex].image.
//  - undo/redo move the pointer (non-destructive — you can redo).
//  - Making a NEW edit while not at the end truncates the forward entries, then appends (branch).
//  - Clicking a thumbnail moves the pointer (revert). Continuing from there branches on the next edit.
// All mutations persist the session to IndexedDB so a refresh restores it.

import { getState, setState } from "../state.js";
import { saveSession, clearSession } from "../db/idb.js";
import { clearSelection } from "./select.js";

let nextId = 1;
const newId = () => `e${nextId++}`;

// Persist the current session slice (fire-and-forget; failures are logged, not fatal).
// Reference items (Pass 6) are part of the session so a refresh restores the tray too.
function persist() {
  const { history, historyIndex, referenceImages } = getState();
  saveSession({ history, historyIndex, referenceImages }).catch((err) => console.warn("[history] persist failed:", err));
}

// Exported for actions/references.js, which mutates a session slice of its own.
export function persistSession() {
  persist();
}

// Start a fresh history from an original photo (called when a new source photo is set).
export function resetHistory(originalBlob) {
  const entry = { id: newId(), prompt: "Original", image: originalBlob, ts: Date.now() };
  setState({ history: [entry], historyIndex: 0, activeImage: originalBlob });
  persist();
}

// Append a successful edit. Branches (drops forward history) if we're not at the end.
// `grounding` (Pass 9): { chunks, queries, renderedContent } | null — the real-world sources a
// grounded edit referenced; persisted with the entry so the Real-matches rail survives reloads.
export function recordEdit(prompt, imageBlob, grounding = null) {
  const { history, historyIndex } = getState();
  const kept = history.slice(0, historyIndex + 1); // truncate forward (branch)
  const entry = { id: newId(), prompt, image: imageBlob, ts: Date.now(), grounding };
  const next = [...kept, entry];
  setState({ history: next, historyIndex: next.length - 1, activeImage: imageBlob });
  persist();
}

export function undo() {
  const { history, historyIndex } = getState();
  if (historyIndex <= 0) return;
  const i = historyIndex - 1;
  clearSelection(); // outline coordinates belong to the image being navigated away from (Pass 8)
  setState({ historyIndex: i, activeImage: history[i].image, draftPreview: null }); // stale draft too (Pass 9)
  persist();
}

export function redo() {
  const { history, historyIndex } = getState();
  if (historyIndex >= history.length - 1) return;
  const i = historyIndex + 1;
  clearSelection();
  setState({ historyIndex: i, activeImage: history[i].image, draftPreview: null });
  persist();
}

// Revert to a specific entry (filmstrip click).
export function jumpTo(index) {
  const { history } = getState();
  if (index < 0 || index >= history.length) return;
  clearSelection();
  setState({ historyIndex: index, activeImage: history[index].image, draftPreview: null });
  persist();
}

// Wipe history + the persisted session (called on "New photo").
export function clearHistory() {
  setState({ history: [], historyIndex: -1 });
  clearSession().catch((err) => console.warn("[history] clear failed:", err));
}

// Restore a persisted session on load. Returns true if one was restored.
export function applyRestoredSession(session) {
  if (!session?.history?.length) return false;
  const idx = Math.min(Math.max(session.historyIndex ?? session.history.length - 1, 0), session.history.length - 1);
  const original = session.history[0].image;
  setState({
    sourceImage: original,
    history: session.history,
    historyIndex: idx,
    activeImage: session.history[idx].image,
    referenceImages: session.referenceImages ?? [],
  });
  // Keep id generator ahead of any restored ids so new ids don't collide.
  for (const e of session.history) {
    const n = Number(String(e.id).replace(/^e/, ""));
    if (Number.isFinite(n) && n >= nextId) nextId = n + 1;
  }
  return true;
}
