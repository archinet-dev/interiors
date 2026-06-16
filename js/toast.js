// toast.js — non-blocking error toasts via the Popover API.
//
// Subscribes to state.error. When it becomes non-null, it shows a manual popover toast with the
// full message (per the project rule: show complete errors) and a dismiss button; it auto-hides
// after a few seconds. Dismissing clears state.error so the same error can re-toast later.

import { getState, setState, subscribe } from "./state.js";

const toast = document.getElementById("toast");
const messageEl = document.getElementById("toast-message");
const closeBtn = document.getElementById("toast-close");

let hideTimer = 0;
let lastError = null;

function show(message) {
  messageEl.textContent = message; // textContent only (H3)
  try { toast.showPopover(); } catch {}
  clearTimeout(hideTimer);
  hideTimer = setTimeout(dismiss, 6000);
}

function dismiss() {
  clearTimeout(hideTimer);
  try { toast.hidePopover(); } catch {}
  if (getState().error) setState({ error: null }); // clear so it can re-toast later
}

closeBtn?.addEventListener("click", dismiss);
// If the user light-dismisses the popover (Esc / click-away), clear the error too.
toast?.addEventListener("toggle", (e) => {
  if (e.newState === "closed" && getState().error) setState({ error: null });
});

subscribe((state) => {
  if (state.error && state.error !== lastError) {
    lastError = state.error;
    show(state.error);
  } else if (!state.error) {
    lastError = null;
  }
});
