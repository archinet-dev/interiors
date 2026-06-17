// actions/exportImage.js — save / share the current design (wireframe section L).
//
// Download writes the current activeImage to a file. Share uses the Web Share API with the image
// file where supported (mobile), falling back to a download otherwise.

import { getState, setState } from "../state.js";

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

// Download the current image as a file.
export function downloadImage() {
  const { activeImage } = getState();
  if (!activeImage) {
    setState({ error: "Nothing to download yet — add a photo first." });
    return;
  }
  const url = URL.createObjectURL(activeImage);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName(activeImage);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000); // revoke after the download has kicked off
}

// Share the current image via the Web Share API; fall back to download where unsupported.
export async function shareImage() {
  const { activeImage } = getState();
  if (!activeImage) {
    setState({ error: "Nothing to share yet — add a photo first." });
    return;
  }
  const file = new File([activeImage], fileName(activeImage), { type: activeImage.type || "image/jpeg" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "My room redesign", text: "Made with Space Makeover Visualizer" });
      return;
    } catch (err) {
      if (err?.name === "AbortError") return; // user cancelled — not an error
      console.warn("[exportImage] share failed, falling back to download:", err);
    }
  }
  downloadImage(); // platform can't share files → download instead
}
