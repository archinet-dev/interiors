# PRE-CODE VERIFICATION REPORT — Space Makeover Visualizer

**Date:** 2026-06-15
**Status:** ⏸ Awaiting sign-off. No source code written. (Per `PROMPT.md`: "STOP after the verification report. Wait for sign-off before writing code.")
**Method:** Three parallel research agents fetched live docs (npm registry, ai.google.dev, MDN, web.dev/baseline, caniuse). Findings consolidated and reconciled below. Nothing here is from training data alone.

---

## 1. SDK SURFACE — ✅ Spec assumptions hold (one ID nuance, see §2)

**Package:** `@google/genai`, current published version **`2.8.0`** (published 2026-06-03, GA, ~weekly minor cadence). **Decision: pin to `2.8.0`** and import via CDN/import-map (no build step — constraint H2).

**Import + constructor — confirmed verbatim:**
```javascript
import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey });   // Developer API form (NOT vertexai:true)
```
Also exported and needed: `Modality`, `Type` (function-declaration type enum).

**Live API (the Pass 2 bridge):** `await ai.live.connect({ model, callbacks, config })` → returns `session`.
- `config` is a flat `LiveConnectConfig`: `responseModalities: [Modality.AUDIO]`, `systemInstruction` (string or Content), `inputAudioTranscription: {}`, `outputAudioTranscription: {}` (empty object = enabled), `tools: [{ functionDeclarations: [...] }]`, `speechConfig`.
- ⚠️ SDK flattens transcription/speech config — do **not** nest under `generationConfig` at the SDK layer (only the raw WS protocol does).

**Image edit:** standard `ai.models.generateContent({ model, contents })` — no separate image method.
- `contents`: `[{ text }, { inlineData: { mimeType, data /* base64 */ } }]`.
- Returned bytes: `response.candidates[0].content.parts[].inlineData.data` (base64) → `atob` → `Uint8Array` → `Blob`.

**Function calling (Live path):** declare with `Type` enum; pass via `config.tools`. Receive in `callbacks.onmessage`:
```javascript
if (message.toolCall) {
  for (const fc of message.toolCall.functionCalls) {
    const result = await runEditImage(fc.args);
    functionResponses.push({ id: fc.id, name: fc.name, response: { result } });
  }
  session.sendToolResponse({ functionResponses });
}
```

**Deprecations:** old `@google/generative-ai` / `GoogleGenerativeAI` / `getGenerativeModel()` is fully superseded by `@google/genai` / `GoogleGenAI` with services on the client (`ai.models.*`, `ai.live.*`). Spec already targets the new SDK — no action.

---

## 2. MODEL IDS — ✅ All three confirmed available (all PREVIEW)

| Spec ID | Status | Note |
|---|---|---|
| `gemini-2.5-flash-native-audio-preview-12-2025` | ✅ available (preview, Developer API) | Exact string confirmed. A newer `gemini-3.1-flash-live-preview` now exists and is what the docs lead with, but the spec's choice is still valid. |
| `gemini-3.1-flash-image-preview` (Nano Banana 2, fast) | ✅ available (preview) | Dedicated docs page exists. Conversational/multi-turn editing, 0.5K–4K, multi-reference. |
| `gemini-3-pro-image-preview` (Nano Banana Pro, hi-q) | ✅ available (preview) | Up to 4K, multi-reference, "thinking" core, ~2–5s latency. |

**Reconciled nuance (the one cross-agent conflict):** docs *page slugs* sometimes drop `-preview` (`gemini-3.1-flash-image`, `gemini-3-pro-image`) — those are the GA/successor track. The **`-preview`-suffixed strings in the spec are the currently-callable IDs** and are correct as written.
**Decision:** use the spec's `-preview` IDs verbatim; keep all three IDs as named constants inside `apiClient.js` (H1/isolation) so a GA swap is a one-line change. Watch for preview retirement at GA.

---

## 3. WEB PLATFORM FEATURES — ✅ Mostly Widely available; 2 real risks

**Widely available, no fallback needed:** Container Queries, `oklch()`/`color-mix()`, Custom Elements/Shadow DOM/`adoptedStyleSheets`, `<template>`/`<slot>`, AudioWorklet, IndexedDB, AbortController, structuredClone, Resize/IntersectionObserver, `<dialog>`, `getUserMedia`, CSS Nesting.

**Newly available — spec-blessed, degrade gracefully where cheap:** View Transitions (`if (!document.startViewTransition)` → swap without animation), Popover API (fall back to `<dialog>`), `:has()`.

**⚠️ RISK 1 — `ImageCapture` is NOT Baseline.** Safari: zero support; Firefox: flagged. **Decision: do not use `ImageCapture` at all.** Capture via `getUserMedia` → `<video>` → draw to `<canvas>` → `canvas.toBlob()`. Affects Pass 1; design the camera path this way from the start.

**⚠️ RISK 2 — CSS Anchor Positioning only cross-engine since Jan 2026** (Safari `@position-try` lags to 18.4+). **Decision:** progressive enhancement only — `@supports (anchor-name: --x)`; Popover API already provides anchored UI without it.

---

## 4. AMBIGUITIES / DECISIONS FOR SIGN-OFF

These were not explicit in `PROMPT.md`. My proposed default is given for each; flag any you want changed.

1. **Runtime/host for Pass 0 testing.** Spec says key is injected by AI Studio runtime OR behind a self-host proxy. For local dev (`python3 -m http.server` over localhost) there is no injected key and no proxy yet. **How do you want Pass 0 to obtain the key locally** without violating H1 (no key in any client file)? Options: (a) you paste a key into a session-only `sessionStorage`/prompt at runtime that is never written to disk; (b) I stand up a tiny local proxy now; (c) you run inside AI Studio. **My default: (a)** — a runtime-entered, never-persisted key read by `apiClient.js`, with a one-line proxy swap documented. **This is the only item that can block Pass 0.**

2. **SDK delivery without a build step.** No bundler allowed. **Default:** load `@google/genai@2.8.0` via an import-map pointing at an ESM CDN (esm.run / esm.sh), so `import { GoogleGenAI } from "@google/genai"` resolves natively.

3. **Pass 0 sample image.** Spec says "hardcoded bundled JPEG." **Default:** commit one small room photo to `assets/` and reference it directly.

4. **Live voice model choice.** Spec's `gemini-2.5-flash-native-audio-preview-12-2025` is valid but no longer the docs' lead model (`gemini-3.1-flash-live-preview` is). **Default:** use the spec's ID as written (H5 — no silent swap), constant in `apiClient.js`.

5. **Branching.** Currently on `main`; only untracked `CLAUDE.md` + this report. **Default:** create a feature branch before Pass 0 and commit per pass.

6. **Wireframes.** I have not yet rendered `wireframes/Space Makeover Visualizer Wireframes.html` (it's a self-unpacking bundled page best opened in a browser). **Default:** open and extract its design tokens/layout in-browser at the start of Pass 0, before writing CSS.

---

## RECOMMENDATION

The stack is sound: SDK surface confirmed, all three model IDs callable, only two platform risks (both with clean, decided mitigations). **The single thing I need from you to start Pass 0 is the answer to Ambiguity #1 (local key handling).** Items #2–#6 I'll proceed on with the stated defaults unless you say otherwise.
