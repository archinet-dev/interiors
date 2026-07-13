// actions/exportImage.js — save / share the current design (wireframe section L; export options Pass 7).
//
// Download writes an image to a file. Share uses the Web Share API with the image file where
// supported (mobile), falling back to a download otherwise. exportImage() adds the Pass 7
// controls: a target aspect ratio (default: original — the exact current Blob, no API call)
// and an optional 2K/4K upscale. A non-original ratio EXPANDS the scene generatively
// (outpaint — never crop/stretch); upscales render via the Pro model. The result can
// optionally be kept in the edit history.

import { getState, setState } from "../state.js";
import { MODELS, SUPPORTED_RATIOS, nearestSupportedRatio, renderForExport } from "../apiClient.js";
import { recordEdit } from "./history.js";

function extFor(blob) {
  const t = blob?.type || "image/jpeg";
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  return "jpg";
}

function fileName(blob) {
  // Timestamp keeps successive downloads distinct (no Date import needed in the browser).
  return `space-makeover-${Date.now()}.${extFor(blob)}`;
}

// Trigger a download of the given Blob.
function deliverDownload(blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName(blob);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000); // revoke after the download has kicked off
}

// Share the given Blob via the Web Share API; fall back to download where unsupported.
// Returns how it ended: 'shared' | 'cancelled' (user dismissed the sheet) | 'downloaded'.
async function deliverShare(blob) {
  const file = new File([blob], fileName(blob), { type: blob.type || "image/jpeg" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "My room redesign", text: "Made with Space Makeover Visualizer" });
      return "shared";
    } catch (err) {
      if (err?.name === "AbortError") return "cancelled"; // user cancelled — not an error, but nothing was delivered
      console.warn("[exportImage] share failed, falling back to download:", err);
    }
  }
  deliverDownload(blob); // platform can't share files → download instead
  return "downloaded";
}

// Share the current image as-is (topbar Share; Download goes through the export dialog).
export async function shareImage() {
  const { activeImage } = getState();
  if (!activeImage) {
    setState({ error: "Nothing to share yet — add a photo first." });
    return;
  }
  await deliverShare(activeImage);
}

// Decode a Blob's pixel dimensions (needed to snap "original" to a supported render ratio).
async function imageDims(blob) {
  const bmp = await createImageBitmap(blob);
  const d = { width: bmp.width, height: bmp.height };
  bmp.close();
  return d;
}

// The most recent generative render, reusable while the inputs are identical. Covers "share
// sheet cancelled → Download instead" (and repeat exports of the same options) without paying
// for a second 10–30s render. Blob identity on `source` keys it to the exact image rendered.
let lastRender = null; // { source: Blob, ratio, size, blob: Blob }

// Export with options (Pass 7). Returns true when the export was DELIVERED (shared or
// downloaded) — the dialog closes only then; a cancelled share sheet returns false so the
// user can pick another delivery without losing the render.
//  - ratio: 'original' | one of SUPPORTED_RATIOS shown in the dialog
//  - size:  'standard' | '2K' | '4K'   (2K/4K render via the Pro model)
//  - share: deliver via the share sheet instead of a download
//  - keepInHistory: also append the rendered result as an undoable edit (only once delivered)
export async function exportImage({ ratio = "original", size = "standard", share = false, keepInHistory = false } = {}) {
  const { activeImage, sourceImage, editingModel, exportBusy, editingInFlight } = getState();
  if (!activeImage) {
    setState({ error: "Nothing to export yet — add a photo first." });
    return false;
  }
  if (exportBusy || editingInFlight) return false; // one render at a time

  // Original shape + standard size = the exact current image; no API call, no history change.
  const expand = ratio !== "original";
  if (!expand && size === "standard") {
    if (share) return (await deliverShare(activeImage)) !== "cancelled";
    deliverDownload(activeImage);
    return true;
  }

  setState({ exportBusy: true });
  try {
    let blob;
    let aspectRatio = ratio;
    if (lastRender && lastRender.source === activeImage && lastRender.ratio === ratio && lastRender.size === size) {
      blob = lastRender.blob; // same image + options as the previous render — reuse it
    } else {
      // "Original" upscales still need an explicit supported ratio — the model drifts the
      // shape when imageConfig.aspectRatio is omitted (live-verified; see apiClient.js).
      if (!expand) {
        const { width, height } = await imageDims(activeImage);
        aspectRatio = nearestSupportedRatio(width, height);
      } else if (!SUPPORTED_RATIOS.includes(aspectRatio)) {
        throw new Error(`Unsupported aspect ratio: ${aspectRatio}`);
      }

      const imageSize = size === "standard" ? undefined : size;
      const model = imageSize ? MODELS.pro : MODELS[editingModel] ?? MODELS.flash;
      blob = await renderForExport(activeImage, { aspectRatio, imageSize, expand, model });
      lastRender = { source: activeImage, ratio, size, blob };

      // R2 check: confirm the render actually landed near the requested shape; warn, don't block.
      const { width, height } = await imageDims(blob);
      const [rw, rh] = aspectRatio.split(":").map(Number);
      if (Math.abs(Math.log((width / height) / (rw / rh))) > Math.log(1.05)) {
        setState({ error: `Heads up: the render came back ${width}×${height}, not quite ${aspectRatio}.` });
      }
    }

    // Deliver FIRST — a cancelled share sheet means nothing was exported, so nothing should
    // enter history and the dialog stays open (the cached render makes a retry free).
    if (share && (await deliverShare(blob)) === "cancelled") return false;
    if (!share) deliverDownload(blob);

    if (keepInHistory) {
      // The render is long and the rest of the UI stays live (undo/jump/retake are not gated on
      // exportBusy). Only append to history if the session is still the one we rendered from —
      // same active image (blob identity) and same source photo. Otherwise the file was still
      // delivered above, just not recorded into a history it no longer belongs to.
      const now = getState();
      if (now.activeImage === activeImage && now.sourceImage === sourceImage) {
        const imageSize = size === "standard" ? undefined : size;
        const label = expand ? `Expanded to ${ratio}${imageSize ? ` · ${imageSize}` : ""}` : `Upscaled to ${imageSize}`;
        recordEdit(label, blob);
      } else {
        setState({ error: "The room changed while rendering — the export was downloaded but not added to history." });
      }
    }
    return true;
  } catch (err) {
    console.error("[exportImage] export render failed:", err);
    setState({ error: `Export failed: ${err?.message ?? err}` });
    return false;
  } finally {
    setState({ exportBusy: false });
  }
}
