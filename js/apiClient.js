// apiClient.js — the ONE chokepoint for every @google/genai SDK call (constraint H1).
//
// The SDK is pointed at our same-origin proxy (`/api/genai`) via httpOptions.baseUrl. The
// browser never holds a real key: the placeholder below is not a secret — the server injects
// the real GEMINI_API_KEY into the upstream request. Switching from this local proxy to a
// production proxy (or, in a managed runtime, direct calls) is a one-line baseUrl change here
// and nothing else in the app moves.
//
// Pass 0 surface: editImage(blob, prompt) → Promise<Blob>. Verified against the live API
// response shape on 2026-06-15: candidates[0].content.parts[].inlineData.{data, mimeType}.

import { GoogleGenAI } from "@google/genai";

// Verified-available preview model IDs (see docs/VERIFICATION_REPORT.md). Kept as constants so a
// GA rename is a single edit in this file.
export const MODELS = {
  flash: "gemini-3.1-flash-image-preview", // Nano Banana 2 — fast default edit
  pro: "gemini-3-pro-image-preview", // Nano Banana Pro — high-quality edit (Pass 4)
};

// Same-origin proxy base. The SDK appends /v1beta/models/... to this.
const PROXY_BASE = `${location.origin}/api/genai`;

// apiKey is a non-secret placeholder; the proxy overrides auth with the real key server-side.
// Exported so other modules (e.g. voiceSession.js) reuse this single instance rather than
// each constructing their own — apiClient.js stays the one @google/genai chokepoint (H1).
export const ai = new GoogleGenAI({
  apiKey: "managed-by-proxy",
  httpOptions: { baseUrl: PROXY_BASE },
});

// Edit an image with a natural-language instruction. Returns a new image Blob.
// `references` (Pass 6) is an optional array of extra Blobs — photos of specific items,
// furniture, or materials the user supplied. They are appended after the room image, with
// framing text telling the model which image is the room and how to treat the rest.
export async function editImage(blob, prompt, model = MODELS.flash, references = []) {
  const text = references.length
    ? `${prompt}

The first image is the current room. Each additional image is a reference photo of a specific item, piece of furniture, or material (e.g. tile, wallpaper, fabric, decor) supplied by the user. When the instruction refers to such an item or material, reproduce it faithfully in the room at a realistic scale; otherwise ignore the reference images. Always return the edited ROOM image, never a reference image.`
    : prompt;

  const contents = [
    { text },
    { inlineData: { mimeType: blob.type || "image/jpeg", data: await blobToBase64(blob) } },
  ];
  for (const ref of references) {
    contents.push({ inlineData: { mimeType: ref.type || "image/jpeg", data: await blobToBase64(ref) } });
  }

  const response = await ai.models.generateContent({ model, contents });

  // Defensive parse (Risk R2): scan ALL candidates, and all parts within each, for the first
  // inline image; tolerate snake_case. Some responses split content across multiple candidates,
  // so checking only candidates[0] can miss an image that did come back.
  const candidates = response?.candidates ?? [];
  let firstText; // remember any text so we can surface the model's message if no image is found
  for (const candidate of candidates) {
    const parts = candidate?.content?.parts ?? [];
    for (const part of parts) {
      const inline = part.inlineData || part.inline_data;
      if (inline?.data) {
        const bytes = base64ToBytes(inline.data);
        return new Blob([bytes], { type: inline.mimeType || inline.mime_type || "image/jpeg" });
      }
      if (firstText === undefined && part.text) firstText = part.text;
    }
  }

  // No image came back across any candidate — surface the model's text (or a clear error).
  throw new Error(
    firstText ? `The model returned no image. It said: "${firstText}"` : "The model returned no image."
  );
}

// --- helpers ---

// Blob → base64 (no data: prefix), via FileReader.
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Failed to read image blob."));
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1)); // strip "data:...;base64,"
    };
    reader.readAsDataURL(blob);
  });
}

// base64 → Uint8Array.
function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
