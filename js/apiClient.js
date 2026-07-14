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

// Verified-available model IDs (original verification in docs/VERIFICATION_REPORT.md; migrated to
// the stable GA IDs in Pass 8 after live-verifying each on 2026-07-14 — the '-preview' suffixed
// IDs were deprecated per the API changelog). Kept as constants so a rename is a single edit here.
export const MODELS = {
  flash: "gemini-3.1-flash-image", // Nano Banana 2 — fast default edit
  pro: "gemini-3-pro-image", // Nano Banana Pro — high-quality edit (Pass 4)
  vision: "gemini-3.5-flash", // detection/segmentation for tap-to-select (Pass 8) — the Gemini 3
  // image models do NOT support masks (per official docs), so locate calls route here.
  lite: "gemini-3.1-flash-lite-image", // Nano Banana 2 Lite — ~4 s draft previews (Pass 9)
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
// opts.grounded (Pass 9): ground the edit in Google Web + Image Search so changes reference REAL
// products (only supported on MODELS.flash; silently skipped elsewhere). Returns
// { image: Blob, grounding: { chunks:[{title,uri}], queries:[string], renderedContent } | null }.
// `grounding.renderedContent` is Google's search-suggestions HTML — the ToS REQUIRES displaying
// it whenever grounded results are shown (see components rendering it).
export async function editImage(blob, prompt, model = MODELS.flash, references = [], target = null, opts = {}) {
  // Pass 8: when the user selected a specific object (tap or voice), scope the edit to it. The
  // image models take the region as prompt text on the same normalized 0-1000 grid the vision
  // model reports boxes in.
  const scoped = target
    ? `Edit ONLY the ${target.label} located within the normalized bounding box [${target.box.join(", ")}] of the image (0-1000 scale, [ymin, xmin, ymax, xmax]). Apply the following instruction to that object/region alone and keep every other part of the image EXACTLY unchanged, including lighting and geometry: ${prompt}`
    : prompt;
  const text = references.length
    ? `${scoped}

The first image is the current room. Each additional image is a reference photo of a specific item, piece of furniture, or material (e.g. tile, wallpaper, fabric, decor) supplied by the user. When the instruction refers to such an item or material, reproduce it faithfully in the room at a realistic scale; otherwise ignore the reference images. Always return the edited ROOM image, never a reference image.`
    : scoped;

  const contents = [
    { text },
    { inlineData: { mimeType: blob.type || "image/jpeg", data: await blobToBase64(blob) } },
  ];
  for (const ref of references) {
    contents.push({ inlineData: { mimeType: ref.type || "image/jpeg", data: await blobToBase64(ref) } });
  }

  // Grounding is a Flash-only capability (Image Search grounding is exclusive to
  // gemini-3.1-flash-image per the model cards) — live-verified shape 2026-07-14. Searching is
  // model-discretionary, so grounded requests carry an explicit nudge; edits with nothing to
  // shop for (e.g. "declutter") simply come back ungrounded and show no rail.
  const grounded = Boolean(opts.grounded) && model === MODELS.flash;
  if (grounded) {
    contents[0] = {
      text: `${contents[0].text}

If this change involves furniture, decor, paint, or materials, search the web (including image search) for real, currently-sold products matching the request and base the change faithfully on one of them.`,
    };
  }
  const request = { model, contents };
  if (grounded) request.config = { tools: [{ googleSearch: { searchTypes: { webSearch: {}, imageSearch: {} } } }] };

  const response = await ai.models.generateContent(request);
  return { image: firstImageFromResponse(response), grounding: grounded ? extractGrounding(response) : null };
}

// Pull the display-worthy grounding facts out of a response: real-source links, the queries the
// model ran, and the ToS-required search-suggestions HTML. Null when the model didn't ground.
function extractGrounding(response) {
  const gm = response?.candidates?.[0]?.groundingMetadata || response?.candidates?.[0]?.grounding_metadata;
  if (!gm) return null;
  const chunks = (gm.groundingChunks || gm.grounding_chunks || [])
    .map((c) => ({ title: c.web?.title || "", uri: c.web?.uri || "" }))
    .filter((c) => c.uri);
  const sep = gm.searchEntryPoint || gm.search_entry_point;
  return {
    chunks,
    queries: gm.webSearchQueries || gm.web_search_queries || [],
    renderedContent: sep?.renderedContent || sep?.rendered_content || "",
  };
}

// Locate a single object or region in the image (Pass 8 tap-to-select). Ask by tap point OR by
// natural-language query ("the grey sofa", "the empty corner"). Returns
//   { label, box: [ymin, xmin, ymax, xmax], polygon: [[y, x], ...] | null }   (all 0-1000)
// or null when the model finds nothing. Routed to MODELS.vision — the Gemini 3 image models do
// not support masks; gemini-3.5-flash does (live-verified 2026-07-14, ~2-3 s).
export async function locateObject(blob, { point, query }) {
  const ask = point
    ? `A user tapped the image at the normalized point y=${point[0]}, x=${point[1]} (0-1000 scale). Identify the single distinct object or surface at exactly that point.`
    : `Find the following in the image: ${query}. Identify the single best-matching object or region.`;
  const text = `${ask}
Return a JSON array with EXACTLY ONE entry: {"label": <2-4 word name>, "box_2d": [ymin, xmin, ymax, xmax] on a 0-1000 normalized scale, "polygon": the object's outline as 8-24 [y, x] vertices (0-1000 scale, in drawing order)}. If nothing identifiable is there, return [].`;

  const response = await ai.models.generateContent({
    model: MODELS.vision,
    contents: [
      { text },
      { inlineData: { mimeType: blob.type || "image/jpeg", data: await blobToBase64(blob) } },
    ],
    config: {
      responseMimeType: "application/json",
      // Docs recommend minimal thinking for detection/segmentation workloads.
      thinkingConfig: { thinkingLevel: "minimal" },
    },
  });

  // The response is requested as JSON, but the model occasionally wraps it (fences, prose) or
  // truncates a long polygon — recover the first JSON array/object rather than failing the tap.
  let raw = (response?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "[]").trim();
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  // Only slice out an array when the payload isn't already a top-level object — a bare
  // {"label":…,"box_2d":[…]} would otherwise be cut at box_2d's brackets and lose its keys.
  if (!raw.startsWith("{")) {
    const a0 = raw.indexOf("[");
    const a1 = raw.lastIndexOf("]");
    if (a0 >= 0 && a1 > a0) raw = raw.slice(a0, a1 + 1);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Salvage a truncated array by parsing just the first complete object inside it.
    const o0 = raw.indexOf("{");
    let depth = 0;
    for (let i = o0; i >= 0 && i < raw.length; i++) {
      if (raw[i] === "{") depth++;
      else if (raw[i] === "}" && --depth === 0) {
        try { parsed = [JSON.parse(raw.slice(o0, i + 1))]; } catch {}
        break;
      }
    }
    if (!parsed) return null; // treat as "nothing identifiable" — the action shows a friendly retry message
  }
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!entry) return null;

  const clamp = (n) => Math.max(0, Math.min(1000, Math.round(Number(n) || 0)));
  const box = Array.isArray(entry.box_2d) && entry.box_2d.length === 4 ? entry.box_2d.map(clamp) : null;
  if (!box || box[2] <= box[0] || box[3] <= box[1]) return null;

  // Polygon is best-effort (model JSON is loosely shaped) — the box is the reliable fallback.
  let polygon = null;
  if (Array.isArray(entry.polygon)) {
    const pts = entry.polygon
      .filter((v) => Array.isArray(v) && v.length === 2)
      .map(([y, x]) => [clamp(y), clamp(x)]);
    if (pts.length >= 3) polygon = pts;
  }
  return { label: String(entry.label || "object").slice(0, 60), box, polygon };
}

// Aspect ratios the image models accept in imageConfig (live-verified 2026-07-13). Exports that
// keep the "original" ratio still must send the nearest supported one: probed Pro at 4K with NO
// aspectRatio and the model drifted the ratio (1.83 source → 2.36 output), so omitting the config
// is not an option for faithful upscales.
export const SUPPORTED_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

// Nearest supported ratio for a width/height (compared in log space so 2:1 and 1:2 are equidistant from 1:1).
export function nearestSupportedRatio(width, height) {
  const target = Math.log(width / height);
  let best = SUPPORTED_RATIOS[0];
  let bestDist = Infinity;
  for (const r of SUPPORTED_RATIOS) {
    const [w, h] = r.split(":").map(Number);
    const dist = Math.abs(Math.log(w / h) - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = r;
    }
  }
  return best;
}

// Render the image for export (Pass 7): expand to a new aspect ratio (generative outpaint —
// never crop/stretch) and/or upscale via the Pro model's imageSize. Both knobs ride on
// imageConfig, which the pinned SDK passes through to generationConfig (live-verified).
//  - aspectRatio: one of SUPPORTED_RATIOS (required — see note above).
//  - imageSize: '2K' | '4K' | undefined (Standard). 2K/4K require the Pro model.
//  - expand: true when the user picked a NEW shape (outpaint prompt); false for a pure upscale
//    at the (nearest-)original ratio (fidelity prompt).
export async function renderForExport(blob, { aspectRatio, imageSize, expand, model = MODELS.flash }) {
  const prompt = expand
    ? "Extend this interior scene outward to completely fill the new canvas. Keep everything already in the photo exactly as it is — same furniture, geometry, lighting, and style — and generate a seamless, realistic continuation of the room to fill the added space. Do not crop, stretch, or restyle the existing content."
    : "Reproduce this exact image at the highest possible fidelity. Do not add, remove, restyle, or reframe anything; if the canvas shape differs slightly, extend the scene minimally at the edges to fit.";

  const response = await ai.models.generateContent({
    model,
    contents: [
      { text: prompt },
      { inlineData: { mimeType: blob.type || "image/jpeg", data: await blobToBase64(blob) } },
    ],
    config: { imageConfig: imageSize ? { aspectRatio, imageSize } : { aspectRatio } },
  });
  return firstImageFromResponse(response);
}

// Defensive parse (Risk R2): scan ALL candidates, and all parts within each, for the first
// inline image; tolerate snake_case. Some responses split content across multiple candidates,
// so checking only candidates[0] can miss an image that did come back.
function firstImageFromResponse(response) {
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
