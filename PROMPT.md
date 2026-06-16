================================================================================
ENGINEERING POSTURE (read this first)
================================================================================
This is a multi-pass, vertical-slice build. The planner's job is to think like a
senior engineer: verify before building, plan before coding, define done in
testable terms, surface risks early, and refuse to silently change requirements.
The product spec is below; the process for delivering it is non-negotiable.

================================================================================
PRODUCT
================================================================================
Build a responsive, device-aware web application called "Space Makeover
Visualizer" that lets a user redesign a room in real time by photographing it
and then talking to a live voice agent that sees the photo, suggests changes,
and edits the image on command.

================================================================================
HARD CONSTRAINTS (violation = the pass is rejected, not iterated on)
================================================================================
H1. No API key, secret, or credential in any file under the client bundle.
    Ever. Not as a TODO. Not as "YOUR_KEY_HERE". Not behind a comment. If the
    runtime is AI Studio, the key is injected at runtime — read it from the
    runtime, do not write it. If self-hosting, the key lives behind a server
    proxy.

H2. No front-end framework, no front-end build step. (See STACK CONSTRAINT.)

H3. No deprecated APIs. Explicitly: no ScriptProcessorNode, no XMLHttpRequest
    where fetch works, no innerHTML on user-controlled strings.

H4. No orphan code. Every file added in a pass must be reachable from the
    browser in that pass. (See METHODOLOGY.)

H5. No silent assumption changes. If you cannot satisfy the prompt as written,
    stop and ask. Do not adapt the requirement and continue.

================================================================================
PRE-CODE VERIFICATION GATE (mandatory before Pass 0)
================================================================================
Before writing any source code, produce a verification report that confirms:

  1. SDK SURFACE — Fetch the current @google/genai docs (npmjs.com/package/
     @google/genai and ai.google.dev/gemini-api/docs/migrate). Quote the exact
     import statement, class name, and constructor signature for the version
     you intend to pin. As of this prompt's writing, the import is:
       import { GoogleGenAI } from "@google/genai";
       const ai = new GoogleGenAI({ apiKey });
     If what you find in current docs differs, FLAG the discrepancy in your
     verification report; do not silently adapt.

  2. MODEL IDS — Check the official models page (ai.google.dev/gemini-api/docs/
     models) and confirm these IDs are currently available on the Gemini
     Developer API:
       - gemini-2.5-flash-native-audio-preview-12-2025  (Live, default)
       - gemini-3.1-flash-image-preview                 (Nano Banana 2, default edit)
       - gemini-3-pro-image-preview                     (Nano Banana Pro, hi-q edit)
     If any are deprecated or renamed, report the current equivalent. Do not
     hardcode a model ID that you have not seen returned by ListModels.

  3. WEB PLATFORM FEATURES — Confirm browser support for the features named in
     STACK CONSTRAINT against current Baseline data. Note any features that are
     NOT yet Baseline-widely-available and the fallback strategy for each.

  4. AMBIGUITIES — List every ambiguity, assumption, or decision you made that
     was not explicit in this prompt. The user reviews this list before Pass 0
     begins.

STOP after the verification report. Wait for sign-off before writing code.

================================================================================
STACK CONSTRAINT
================================================================================
Vanilla JavaScript (ES2024+ modules), HTML5, and CSS only. No React, Vue,
Svelte, Lit, Alpine, or any front-end framework. No CSS frameworks (no
Tailwind, no Bootstrap). No build step for the UI layer — the app must run
from a static server with `<script type="module">` imports working directly.

SDKs are allowed and encouraged where they save real plumbing:
  - @google/genai (ES module import) for the Gemini API and Live API.
  - That's it. Everything else uses the web platform directly.

Leverage modern web platform features (June 2026 baseline):
  - View Transitions API (document.startViewTransition) for before/after and
    edit-history animations — no animation library.
  - Popover API + <dialog> for menus, settings, and modal flows. Prefer the
    declarative `popover` / `popovertarget` attributes over hand-rolled JS.
  - CSS Container Queries (@container) for component-level responsiveness
    instead of only viewport media queries.
  - CSS Nesting and the :has() selector — no preprocessor.
  - CSS custom properties for the design system; oklch() and color-mix() for
    color tokens.
  - CSS Anchor Positioning where supported (with graceful fallback) for
    tooltips/transcript bubbles attached to UI elements.
  - Custom Elements (Web Components) where component encapsulation pays off —
    e.g. <voice-indicator>, <before-after>, <edit-history>. Use Shadow DOM and
    constructable stylesheets (adoptedStyleSheets) for style isolation.
    Plain modules are fine where encapsulation doesn't earn its keep — don't
    cargo-cult custom elements everywhere.
  - <template> + <slot> for repeated DOM structures.
  - getUserMedia + ImageCapture for the camera; MediaStream APIs for audio.
  - AudioWorklet (NOT the deprecated ScriptProcessorNode) for any custom audio
    processing. The @google/genai SDK handles most of this; if you reach below
    the SDK for raw PCM, use AudioWorklet.
  - IndexedDB (via a tiny promise wrapper, not a library) for persisting the
    edit history across sessions. localStorage only for small UI prefs.
  - AbortController for cancelable fetches and Live sessions.
  - structuredClone for deep state copies.
  - ResizeObserver / IntersectionObserver where appropriate.
  - Modern dialog focus management and the inert attribute — let the platform
    handle a11y instead of reimplementing it.

================================================================================
STATE & RENDER CONTRACT (required pattern)
================================================================================
Without a framework's reactivity, the failure mode is scattered innerHTML
mutations and tangled imperative updates. Use this single pattern throughout.

State is FLAT. No nested objects beyond one level. setState performs a SHALLOW
merge of top-level keys. No special cases. No deep-merge logic. If you find
yourself wanting nested state, flatten it into prefixed top-level keys
(voiceStatus, voiceTranscript) — not voice: { ... }. Rationale: deep-merge
with a 30-line pub/sub is a footgun; flat state plus shallow merge stays
predictable for the life of the project.

1. ONE state module (`state.js`) exports:
     - getState() → returns a frozen snapshot
     - setState(partial) → shallow-merges, freezes, then notifies subscribers
     - subscribe(fn) → returns an unsubscribe function
   It's a tiny pub/sub. ~30 lines. No external dependency.

2. State shape (flat — extend with prefixed keys, never with nesting):
     {
       sourceImage: Blob | null,          // the original captured photo
       activeImage: Blob | null,          // the current edited image
       history: [{ id, prompt, image, ts }],
       voiceStatus: 'idle'|'listening'|'thinking'|'speaking',
       voiceTranscript: [],
       editingInFlight: false,
       editingModel: 'flash'|'pro',
       error: string | null
     }

3. Each component (or custom element) subscribes to state on connect, and
   re-renders the parts of its DOM that depend on state slices it cares about.
   Renders are batched with requestAnimationFrame — multiple setState calls in
   the same frame coalesce into one render.

4. Visual state transitions (active image swap, history additions) wrap their
   DOM update in document.startViewTransition() so the change animates
   automatically via the View Transitions API.

5. No component mutates state directly. All changes go through setState. All
   side-effectful work (API calls, recording) lives in action modules
   (`actions/editImage.js`, `actions/voiceSession.js`, etc.) that call
   setState when they complete.

6. Blob URL discipline: every URL.createObjectURL must have a matching
   URL.revokeObjectURL when the URL is no longer rendered. Track the
   currently-rendered Blob (not its URL string) when deciding whether to
   re-render — `createObjectURL` returns a new string on every call, so
   string comparison is not a valid skip-render guard.

================================================================================
ARCHITECTURE
================================================================================
Voice/conversation layer:
  Gemini Live API over a bidirectional WebSocket using a native-audio model.
  Default: gemini-2.5-flash-native-audio-preview-12-2025 (Gemini Developer
  API). Verify the current default in AI Studio (see Verification Gate); the
  @google/genai SDK exposes the Live session. Enable input + output audio
  transcription, barge-in / interruption, and a system instruction that frames
  the agent as an interior-design assistant. Pass the current room image as
  visual context on session start and on every edit so the agent can ground
  suggestions in what it actually sees.

Edit layer:
  Image generation/editing via the Nano Banana family.
  - Default (fast iterative edits): Nano Banana 2 = gemini-3.1-flash-image-preview
  - "Render in high quality" toggle: Nano Banana Pro = gemini-3-pro-image-preview
    (up to 4K, supports multiple reference images for guided generation).

The bridge between layers is FUNCTION CALLING:
  Register the image-edit operation as a tool the Live agent can call. The
  voice agent listens, decides an edit is needed, calls the edit function
  with a structured prompt (and the source image), receives the generated
  image, updates state, and narrates the result. This tool-use hand-off is
  the central mechanism — Pass 2 of the vertical slice plan builds it.

API KEY HANDLING:
  See H1. Inside the AI Studio runtime the key is managed for the app. If
  exported and self-hosted, route all SDK calls through one `apiClient.js`
  module so swapping to a server proxy is a single config flip, not a
  refactor.

================================================================================
EDITING CAPABILITIES (all conversational, applied to the captured photo)
================================================================================
- Add furniture and decor that wasn't there.
- Remove or replace existing furniture.
- Change materials, colors, finishes, lighting, and wall/floor treatments.
- Overlay or restyle decor while preserving the room's geometry and perspective.

================================================================================
UI / UX
================================================================================
- Live camera/photo view with a clear capture control. On mobile, camera-first.
  On desktop, upload-or-camera with drag-and-drop onto the capture area.
- Persistent <voice-indicator> showing listening / thinking / speaking states
  plus a running transcript (input + output captions from the Live session).
- <before-after> component with a draggable divider OR a toggle, animated via
  View Transitions.
- <edit-history> as a horizontal filmstrip; tap any entry to revert. Undo/redo
  via state history pointer. Persisted in IndexedDB so a refresh doesn't wipe
  the user's session.
- Streaming/loading states for both audio (waveform or pulse) and image
  generation (skeleton or progressive reveal). The UI never blocks.
- Settings popover (using the Popover API) for model selection
  (Flash vs Pro), voice, and camera device.
- Use the prefers-reduced-motion media query to disable view transitions and
  animations for users who opt out.
- Use prefers-color-scheme and a manual toggle; design tokens in CSS custom
  properties so both themes are one var-swap.
  
- Fetch this design file, read its readme, and implement the relevant aspects of the design. https://api.anthropic.com/v1/design/h/sXw2IAQSIvjdgiT7ZgP8Yg?open_file=Space+Makeover+Visualizer+-+Wireframes.dc.html
- Implement: Space Makeover Visualizer - Wireframes.dc.html
- `/Users/twoedge/Dev/interiors_proto/interiors/wireframes/Space Makeover Visualizer Wireframes.html`

================================================================================
DEVELOPMENT METHODOLOGY: VERTICAL SLICE / WALKING SKELETON
================================================================================
This project uses vertical slice development. Every pass must result in a
fully runnable, browser-testable app. No orphan code. No forward-scaffolding.
Wire all layers together first, then grow.

Each pass produces three artifacts before any code is written:
  (a) Acceptance Criteria — testable assertions (see ACCEPTANCE CRITERIA).
  (b) Risk Register — 1–3 risks specific to this pass with mitigations
      (see RISK REGISTER).
  (c) File Manifest — every file that will be added or modified, with a
      one-line justification per file.

The pass is not complete until every acceptance criterion is checked, the
budgets (see BUDGETS) still hold, the capability ledger is updated, and a
pass report (see PASS REPORT FORMAT) is delivered.

----- PASS 0 — WALKING SKELETON -----
Capability: "User opens the app, sees a hardcoded room photo, clicks one
button, and watches it transform via the image-edit API."

  - HTML: one index.html with a <main> containing an <img> and a single
    <button>Try a sample edit</button>.
  - CSS: minimal layout (centered, responsive). Design tokens defined as
    CSS custom properties even if only two are used.
  - JS modules:
      state.js       — the pub/sub state module described above.
      apiClient.js   — wraps @google/genai, exports `editImage(blob, prompt)`.
      actions/editImage.js — calls apiClient, updates state.
      main.js        — wires button → action, subscribes to state, swaps <img>.
  - The button calls editImage with a hardcoded prompt ("add a houseplant in
    the corner") against a hardcoded bundled JPEG.
  - The <img> swap is wrapped in document.startViewTransition().

  Done when: the acceptance criteria below pass in a browser. This proves SDK
  works, API key handling works (via the runtime, NOT hardcoded), state→render
  works, view transitions work. STOP. Get sign-off before Pass 1.

----- PASS 1 — REAL CAMERA / UPLOAD -----
Capability: "User captures or uploads their own photo, then runs the same
hardcoded edit on it."

  - Add a <camera-capture> custom element using getUserMedia + ImageCapture,
    with file-upload fallback (drag-and-drop + <input type="file">).
  - Captured/uploaded Blob → setState({ sourceImage, activeImage }).
  - Button now edits the active image.
  - Permissions denial path: render the upload UI instead. No console error.

----- PASS 2 — VOICE TOOL CALL (the central mechanism) -----
Capability: "User speaks a request, the Live agent decides to edit, the edit
runs, the agent narrates the result."

  - Add actions/voiceSession.js: opens a Live session via @google/genai with:
      * system instruction (interior-design assistant persona)
      * the current sourceImage as visual context
      * one registered tool: editImage({ prompt: string }) → returns image
  - Add <voice-indicator> custom element with mic toggle and status display.
  - Wire the tool implementation to actions/editImage. The Live agent's
    tool call triggers a real edit; on completion, the new image is fed back
    to the agent as the tool result so it can describe what changed.
  - Transcript (input + output) renders into state.voiceTranscript.

----- PASS 3 — EDIT HISTORY + UNDO/REDO -----
Capability: "User can revert to any prior edit and continue from there."

  - Append each successful edit to state.history; persist to IndexedDB.
  - Render <edit-history> filmstrip; clicking an entry sets activeImage and
    truncates forward history (branching from that point).
  - Keyboard: Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z.

----- PASS 4 — BEFORE/AFTER + HIGH-QUALITY RENDER -----
Capability: "User compares original vs current and can request a Pro render."

  - <before-after> draggable-divider component.
  - Settings popover with a Flash/Pro toggle (gemini-3.1-flash-image-preview
    vs gemini-3-pro-image-preview). Pro is opt-in per edit (cost/quality
    tradeoff) — surface that briefly in the UI.

----- PASS 5 — POLISH -----
Capability: "App feels finished."

  - prefers-reduced-motion paths verified end-to-end.
  - Light/dark themes via prefers-color-scheme + manual toggle.
  - Error recovery: clear, non-blocking error toasts (using the Popover API).
  - PWA manifest + a minimal service worker so the shell is installable and
    works offline for navigation (network is still required for inference).

Maintain a capability ledger in README.md, updated at the end of each pass,
listing what each layer currently supports.

================================================================================
ACCEPTANCE CRITERIA (per pass)
================================================================================
At the end of each pass, produce a checklist of testable assertions that a
human can execute in five minutes. Format:

  Pass N — Acceptance Criteria
    [ ] Open the app at /. No console errors. No network errors in DevTools.
    [ ] <specific UI element> is visible and <specific state>.
    [ ] <specific user action> produces <specific observable result> within Xs.
    [ ] <specific failure mode> is handled with <specific UI behavior>.
    [ ] All files added in this pass are referenced from index.html or a
        module already loaded by index.html. (Run: list every file, justify
        every line.)

A pass is not complete until every box is checked. If a box cannot be checked,
state which and why; do not mark the pass done.

Example for Pass 0:
  [ ] Page loads at localhost. No 404s. No console errors.
  [ ] Sample room image is visible within 2s.
  [ ] "Try a sample edit" button is enabled once the image loads.
  [ ] Clicking the button: button shows "Editing..." within 100ms, disables,
      and the image swaps within 10s via a visible cross-fade.
  [ ] Subsequent click swaps again (state→render is idempotent, not one-shot).
  [ ] DevTools Memory: image blob URLs are revoked (no leak across 10 clicks).
  [ ] state.getState() returns a frozen object; mutation attempts throw in
      strict mode.
  [ ] No string matching "YOUR_" or "API_KEY" or "sk-" exists in any client
      file. (grep before claiming done.)

================================================================================
RISK REGISTER (per pass)
================================================================================
Before starting each pass, list 1–3 risks specific to that pass with concrete
mitigations. Examples:

  Pass 2 — Risks
    R1. Live agent calls editImage with a vague prompt ("make it nice") →
        poor edits. Mitigation: tool schema requires concrete subject + change
        verb; system instruction includes few-shot examples of well-formed
        edit calls.
    R2. Mic permission denied mid-session → app appears frozen. Mitigation:
        wire permission change events to voiceStatus = 'idle' and surface a
        re-request UI.
    R3. Network drop during a Live session → ghost "thinking" state.
        Mitigation: AbortController + heartbeat; transition to 'idle' on
        timeout and show a recoverable toast.

The point is to name failure modes before discovering them in production.

================================================================================
BUDGETS (enforced every pass, not just at the end)
================================================================================
- First meaningful paint < 1.5s on a throttled 4G profile.
- No main-thread task > 50ms during voice or image-edit.
- Lighthouse Accessibility ≥ 95 at the end of every pass (not just Pass 5).
- Keyboard-only path through the app works at every pass.
- All animations respect prefers-reduced-motion.
- No memory leaks: 50 image edits in a row should not grow heap monotonically
  (DevTools Memory snapshot before/after).

If a pass would break a budget, fix the regression in the same pass. Do not
defer.

================================================================================
WHEN TO STOP AND ASK
================================================================================
Stop and ask the user when:
  - A documented constraint and an inferred requirement conflict.
  - An external service does not behave as the prompt claims (model deprecated,
    SDK signature differs, feature unsupported).
  - A choice has material lock-in (database schema, public API shape, file
    format) and the prompt is silent on the tradeoff.

Otherwise: decide, document the decision in the pass report, and proceed. Do
not stall on minor stylistic choices; do not silently rewrite requirements.

================================================================================
PASS REPORT FORMAT
================================================================================
At the end of each pass, output:
  1. CAPABILITY ADDED — one sentence.
  2. FILES TOUCHED — list, with a one-line justification per file.
  3. ACCEPTANCE CRITERIA — pass/fail per item, with notes on any failures.
  4. DECISIONS MADE — anything the prompt didn't specify that you chose, and
     why.
  5. RISKS CARRIED FORWARD — risks identified but not yet mitigated, with the
     pass in which they will be addressed.
  6. CAPABILITY LEDGER UPDATE — append to README.md.

================================================================================
REFERENCES
================================================================================
- ai.google.dev/gemini-api/docs/image-generation
- ai.google.dev/gemini-api/docs/live-api (or current path) for Live session shape
- ai.google.dev/gemini-api/docs/migrate for the @google/genai SDK surface
- npmjs.com/package/@google/genai for the current published version
- developer.mozilla.org for View Transitions, Popover, Container Queries,
  Custom Elements, AudioWorklet, IndexedDB
- web.dev/baseline for current Baseline support data