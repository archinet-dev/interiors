// export.js — wire the Export dialog (Pass 7) to state and the export action.
//
// The <dialog> markup lives in index.html; the platform handles modality, focus trap, Esc, and
// backdrop. This module opens it from the topbar Download button, mirrors busy state, and runs
// the export with the chosen options. Original/Standard is the default — that path downloads
// the exact current image with no API call, so the quick one-tap export stays quick.

import { getState, subscribe } from "./state.js";
import { exportImage } from "./actions/exportImage.js";

const dialog = document.getElementById("export-dialog");
const openButton = document.getElementById("download-button");
const cancelButton = document.getElementById("export-cancel");
const shareButton = document.getElementById("export-share");
const downloadButton = document.getElementById("export-download");
const keepCheckbox = document.getElementById("export-keep");

const chosen = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;

openButton.addEventListener("click", () => dialog.showModal());
cancelButton.addEventListener("click", () => dialog.close());

async function run(share) {
  const ok = await exportImage({
    ratio: chosen("export-ratio"),
    size: chosen("export-size"),
    share,
    keepInHistory: keepCheckbox.checked,
  });
  if (ok && dialog.open) dialog.close();
}
downloadButton.addEventListener("click", () => run(false));
shareButton.addEventListener("click", () => run(true));

// Reflect busy state: lock the controls and show progress on the primary button while a
// render is in flight (Esc/cancel stays available — closing does not abort the download).
function render(state) {
  const busy = state.exportBusy;
  downloadButton.disabled = busy;
  shareButton.disabled = busy;
  downloadButton.textContent = busy ? "Rendering…" : "↧ Download";
  for (const input of dialog.querySelectorAll("input")) input.disabled = busy;
}
subscribe(render);
render(getState());
