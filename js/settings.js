// settings.js — wire the native Settings popover to state.
//
// The popover markup lives in index.html and uses the platform Popover API (popovertarget), so
// light-dismiss, Esc, and focus are handled by the browser. This module only mirrors the model
// choice into state and keeps the radios in sync if state changes elsewhere.

import { getState, setState, subscribe } from "./state.js";

const radios = document.querySelectorAll('input[name="edit-model"]');

// User picks a model → store it.
for (const radio of radios) {
  radio.addEventListener("change", () => {
    if (radio.checked) setState({ editingModel: radio.value }); // 'flash' | 'pro'
  });
}

// Keep the radios reflecting state (e.g. on restore).
function sync(state) {
  for (const radio of radios) radio.checked = radio.value === state.editingModel;
}
subscribe(sync);
sync(getState());
