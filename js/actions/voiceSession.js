// actions/voiceSession.js — the central mechanism: a live voice agent that sees the photo and
// edits it via function calling.
//
// Opens a Gemini Live session (through the Bun WS proxy — key stays server-side, H1), registers
// the editImage tool, streams mic audio up, plays the agent's audio down, mirrors transcripts into
// state, and routes tool calls to the real edit action. After each edit the new image is sent back
// so the agent can describe what changed (per the spec).

import { Modality, Type } from "@google/genai";
import { ai } from "../apiClient.js"; // shared SDK instance — apiClient is the one chokepoint (H1)
import { getState, setState } from "../state.js";
import { runEdit } from "./editImage.js";
import { selectByQuery } from "./select.js";
import { startMicCapture, PcmPlayer } from "../audio/audioIO.js";

// Live model. Migrated in Pass 10 from gemini-2.5-flash-native-audio-preview-12-2025 (the
// official docs name this exact model-string swap) because the walk-around scan needs realtime
// VIDEO input — the 2.5 native-audio model ignores video frames (verified empirically), while
// this one is documented for "bidirectional voice and video agents".
const LIVE_MODEL = "gemini-3.1-flash-live-preview";

const SYSTEM_INSTRUCTION = `You are a friendly, concise interior-design assistant in a live voice conversation. You can SEE the user's room photo and any edited versions sent to you.

When the user asks for a change to the room, call the editImage tool with a CONCRETE, specific prompt that names the subject and the change — e.g. "replace the grey sofa with a tan leather sofa", "paint the walls sage green", "add a large potted fiddle-leaf fig in the empty corner". Preserve the room's geometry, perspective, and lighting. Do not call the tool for general chit-chat or questions.

The user may also attach reference photos of specific items — furniture, decor, tiles, wallpaper, or other materials — that they want in the room. You will be shown each one. Attached reference photos are automatically included with every editImage call, so when the user asks to use one, call editImage with a prompt that explicitly refers to it and says where to put or apply it — e.g. "add the armchair from the reference photo next to the window", "retile the floor with the tile shown in the reference photo".

The user can also TAP an object in the photo to select it; you will be told when they do. While something is selected, edit requests apply to that object only. Independently, when the user's request clearly targets ONE object or surface ("make the sofa green", "just this wall"), pass the tool's optional "target" argument with a short name for it — the app will locate it precisely, outline it for the user, and scope the edit to it. Leave "target" out for whole-room changes.

After an edit completes you will receive the updated photo; describe what changed in ONE short spoken sentence. Keep all spoken replies brief and natural.`;

const editImageTool = {
  name: "editImage",
  description: "Edit the current room image with a concrete natural-language instruction.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      prompt: {
        type: Type.STRING,
        description: "A concrete edit naming the subject and the change, grounded in the photo.",
      },
      target: {
        type: Type.STRING,
        description:
          "Optional. When the change is meant for ONE specific object or surface, its short name (e.g. 'the grey sofa', 'the right wall'). Omit for whole-room edits.",
      },
    },
    required: ["prompt"],
  },
};

let session = null;
let mic = null;
let player = null;
let sentRefIds = new Set(); // reference ids already shown to the CURRENT session (dedupe)
let handlingTool = false; // true while the queue drain loop is running (serializes edits)
let pendingToolCalls = []; // FIFO queue of functionCalls awaiting an editImage + tool response
let startGeneration = 0; // bumped each startVoiceSession; lets a slow connect detect it was superseded
let stopping = false; // re-entrancy guard so onerror/onclose → stopVoiceSession can't recurse

// Open the Live session and start streaming the mic. Idempotent.
export async function startVoiceSession() {
  if (session) return;
  // Ground the session in the CURRENT image: edits/undo/redo change activeImage, so the photo the
  // agent should see is activeImage (falling back to sourceImage before any edit has happened).
  const { activeImage, sourceImage } = getState();
  const contextImage = activeImage || sourceImage;
  if (!contextImage) {
    setState({ error: "Add a photo first, then start the voice assistant." });
    return;
  }

  // Generation token: capture this start's id so a late-resolving connect() can tell whether a
  // stopVoiceSession() (or another start) ran while we were awaiting, and bail instead of
  // resurrecting a session the user already closed.
  const myGeneration = ++startGeneration;

  try {
    setState({ voiceStatus: "listening", voiceActive: true, error: null, voiceTranscript: [] });
    player = new PcmPlayer();

    const live = await ai.live.connect({
      model: LIVE_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: SYSTEM_INSTRUCTION,
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        tools: [{ functionDeclarations: [editImageTool] }],
      },
      callbacks: {
        onopen: () => console.log("[voice] session open"),
        // Socket-level error or close → full teardown (mic, player, session) so we never leave a
        // half-dead session running. Surface a friendly message on error.
        onerror: (e) => {
          console.error("[voice] ws error:", e);
          setState({ error: "Voice connection error." });
          stopVoiceSession();
        },
        onclose: (e) => {
          console.log("[voice] session closed:", e?.reason || "");
          stopVoiceSession();
        },
        onmessage: onLiveMessage,
      },
    });

    // If a stop (or restart) happened while connect() was in flight, this session is stale:
    // close it and abandon setup rather than overwriting the current state.
    if (myGeneration !== startGeneration || stopping) {
      try { live.close(); } catch {}
      return;
    }
    session = live;
    sentRefIds = new Set(); // fresh session — nothing has been shown to it yet

    // Send the current photo as visual context on session start (spec), then any attached
    // reference items (Pass 6) so the agent knows what the user wants to work in. Sends are
    // bound to THIS instance (live): if a stop/restart lands while one is awaited, the helper
    // sees the instance was superseded and no-ops instead of leaking into a newer session.
    await sendImageContext(live, contextImage, "Here is the room photo I'm working with.");
    for (const ref of getState().referenceImages) await sendReferenceTo(live, ref);

    // Start mic capture → stream PCM frames to the session.
    mic = await startMicCapture((pcmBuffer) => {
      if (!session) return;
      session.sendRealtimeInput({
        audio: { data: arrayBufferToBase64(pcmBuffer), mimeType: "audio/pcm;rate=16000" },
      });
    });
    // If the session was stopped (or superseded) while the mic permission dialog was up, don't
    // leave the mic or session running — tear down whatever this start brought up.
    if (myGeneration !== startGeneration || stopping || !session) {
      mic.stop();
      mic = null;
      try { live.close(); } catch {}
      if (session === live) session = null;
      return;
    }
  } catch (err) {
    // Expected user conditions (denied/no mic) are warnings; anything else is a real error.
    const expected = ["NotAllowedError", "SecurityError", "NotFoundError"].includes(err?.name);
    (expected ? console.warn : console.error)("[voice] could not start:", err?.name || err);
    setState({ error: friendlyMicError(err), voiceStatus: "idle", voiceActive: false });
    await stopVoiceSession();
  }
}

// Tear down everything cleanly. Re-entrancy guarded so the Live onerror/onclose callbacks (which
// call back into here) can't recurse while we're already tearing down.
export async function stopVoiceSession() {
  if (stopping) return;
  stopping = true;
  // Invalidate any in-flight startVoiceSession so a late connect() resolves into a no-op.
  startGeneration++;
  try {
    stopRoomScan("session"); // camera burst can't outlive its session (Pass 10)
    try { mic?.stop(); } catch {}
    try { player?.stop(); } catch {}
    try { session?.close(); } catch {}
    mic = null;
    player = null;
    session = null;
    handlingTool = false;
    pendingToolCalls = [];
    setState({ voiceStatus: "idle", voiceActive: false });
  } finally {
    stopping = false;
  }
}

// Show the agent a reference item the user attached (Pass 6). Takes the whole entry
// ({ id, image }) so per-session dedupe works: a reference attached while the session is still
// starting up would otherwise be sent both here and by the startup loop. No-op when no session
// is open — startVoiceSession sends whatever is attached at that point instead.
export async function sendReferenceContext(ref) {
  const target = session; // bind to the instance open NOW, not whatever exists after the await
  if (!target) return;
  await sendReferenceTo(target, ref);
}

// Send one reference to a specific session instance, at most once per session.
async function sendReferenceTo(target, ref) {
  if (sentRefIds.has(ref.id)) return;
  // Don't brief the agent on an item the user removed while earlier sends were in flight.
  if (!getState().referenceImages.some((r) => r.id === ref.id)) return;
  sentRefIds.add(ref.id); // mark BEFORE the await so a concurrent send of the same ref dedupes
  try {
    await sendImageContext(
      target,
      ref.image,
      "The user attached this reference photo of an item or material they may want to use in the room."
    );
  } catch (err) {
    sentRefIds.delete(ref.id); // send failed — leave it eligible so a later attempt can retry
    throw err;
  }
}

// --- Walk-around scan (Pass 10): stream live camera frames into the voice session ---
//
// A short "show the room" burst: back camera → downscaled JPEG frames at 1 fps (the Live API's
// documented max) → sendRealtimeInput({ media }). Bursts are capped well under the ~2-minute
// audio+video session limit so the voice session itself survives the scan ending.

const SCAN_MAX_MS = 45_000; // burst cap (audio+video Live sessions are limited to ~2 min total)
const SCAN_FRAME_MS = 1_000; // Live API accepts at most 1 video frame per second
let scan = null; // { stream, video, canvas, timer, target } — set the moment setup BEGINS
let scanFramesSent = 0; // exposed via getScanFrameCount() for verification

export function getScanFrameCount() {
  return scanFramesSent;
}

export async function startRoomScan() {
  if (!session) {
    setState({ error: "Start the voice assistant first, then show it the room." });
    return false;
  }
  if (scan) return true; // already scanning OR mid-setup — a second tap can't open a second camera
  const target = session; // bind the burst to the session open NOW

  // Claim the singleton BEFORE any await: concurrent taps during the permission prompt or
  // video.play() would otherwise each open a stream and orphan all but the last.
  const mine = { stream: null, video: null, canvas: null, timer: 0, target };
  scan = mine;
  try {
    mine.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 } },
    });
    // Stopped (stopRoomScan nulled `scan`) or session died while the prompt was up → clean up.
    if (scan !== mine || session !== target) {
      for (const t of mine.stream.getTracks()) t.stop();
      if (scan === mine) { scan = null; setState({ scanActive: false }); }
      return false;
    }
    mine.video = document.createElement("video");
    mine.video.muted = true;
    mine.video.playsInline = true;
    mine.video.srcObject = mine.stream;
    await mine.video.play();
    // Re-check after EVERY await — play() can outlive the session too.
    if (scan !== mine || session !== target) {
      for (const t of mine.stream.getTracks()) t.stop();
      if (scan === mine) { scan = null; setState({ scanActive: false }); }
      return false;
    }

    target.sendClientContent({
      turns: [{ role: "user", parts: [{ text: "(The user is showing you around the room with their live camera. Frames arrive about once per second — track what you see so you can discuss the room, and briefly acknowledge that you can see it.)" }] }],
      turnComplete: true,
    });

    mine.canvas = document.createElement("canvas");
    const deadline = Date.now() + SCAN_MAX_MS;
    scanFramesSent = 0;
    mine.timer = setInterval(async () => {
      if (scan !== mine) return; // stopped — a stale tick must not touch anything
      if (!session || session !== target) return stopRoomScan("session");
      if (Date.now() > deadline) return stopRoomScan("time");
      const w = mine.video.videoWidth;
      const h = mine.video.videoHeight;
      if (!w || !h) return; // camera warming up
      const scale = Math.min(1, 768 / Math.max(w, h)); // frames are context, not art — keep them light
      mine.canvas.width = Math.round(w * scale);
      mine.canvas.height = Math.round(h * scale);
      mine.canvas.getContext("2d").drawImage(mine.video, 0, 0, mine.canvas.width, mine.canvas.height);
      const blob = await new Promise((resolve) => mine.canvas.toBlob(resolve, "image/jpeg", 0.7));
      // Encoding is async — the scan may have been stopped mid-tick; never send after stop.
      if (!blob || scan !== mine || session !== target) return;
      const data = await blobToBase64(blob);
      if (scan !== mine || session !== target) return;
      // The dedicated `video` realtime field — the SDK's `media` maps to legacy mediaChunks,
      // which the native-audio model ignores (verified empirically: frames sent that way were
      // invisible to the agent; via `video` it describes them).
      target.sendRealtimeInput({ video: { data, mimeType: "image/jpeg" } });
      scanFramesSent++;
    }, SCAN_FRAME_MS);

    setState({ scanActive: true, error: null });
    return true;
  } catch (err) {
    // Whatever was acquired before the failure gets released — no orphaned camera light.
    if (mine.timer) clearInterval(mine.timer);
    if (mine.stream) for (const t of mine.stream.getTracks()) t.stop();
    if (scan === mine) scan = null;
    setState({ scanActive: false });
    const expected = ["NotAllowedError", "SecurityError", "NotFoundError"].includes(err?.name);
    (expected ? console.warn : console.error)("[voice] scan could not start:", err?.name || err);
    setState({ error: friendlyCameraError(err) });
    return false;
  }
}

// reason: 'user' (tapped stop) | 'time' (burst cap) | 'session' (voice session ended)
export function stopRoomScan(reason = "user") {
  if (!scan) return;
  if (scan.timer) clearInterval(scan.timer);
  if (scan.stream) for (const t of scan.stream.getTracks()) t.stop();
  const { target } = scan;
  scan = null;
  setState({ scanActive: false });
  // Tell the agent the visual stream ended (context only) — unless the whole session is going away.
  if (reason !== "session" && target && target === session) {
    try {
      target.sendClientContent({
        turns: [{ role: "user", parts: [{ text: reason === "time" ? "(The camera scan ended automatically after its time limit.)" : "(The user stopped the camera scan.)" }] }],
        turnComplete: false,
      });
    } catch {}
  }
}

function friendlyCameraError(err) {
  const name = err?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Camera permission denied — allow camera access to show the room.";
  if (name === "NotFoundError") return "No camera found.";
  return `Could not start the camera scan: ${err?.message || err}`;
}

// Tell the agent about tap-selection changes (Pass 8). No-ops when no session is open.
export function announceSelection(label) {
  const target = session;
  if (!target) return;
  target.sendClientContent({
    turns: [{ role: "user", parts: [{ text: `(The user tapped the photo and selected: ${label}. Treat edit requests as targeting it unless they clearly say otherwise.)` }] }],
    turnComplete: false, // context only — don't force the agent to respond
  });
}
export function announceSelectionCleared() {
  const target = session;
  if (!target) return;
  target.sendClientContent({
    turns: [{ role: "user", parts: [{ text: "(The user cleared the photo selection — edits apply to the whole room again.)" }] }],
    turnComplete: false,
  });
}

// Send a text turn (used as a fallback and for automated testing of the tool-call bridge).
export function sendUserText(text) {
  if (!session) return;
  appendTranscript("user", text);
  session.sendClientContent({ turns: text });
}

// --- Live message handling ---

async function onLiveMessage(msg) {
  // 1) Tool call → enqueue the functionCalls and drain serially. Queuing (rather than dropping
  //    calls that arrive while one is running) guarantees EVERY functionCall gets a tool response,
  //    so no call id is ever left dangling.
  const calls = msg.toolCall?.functionCalls;
  if (calls?.length) {
    pendingToolCalls.push(...calls);
    drainToolCalls(); // fire-and-forget; self-guards against concurrent drains
  }

  // 2) Transcriptions (input + output captions).
  const inText = msg.serverContent?.inputTranscription?.text;
  if (inText) appendTranscript("user", inText);
  const outText = msg.serverContent?.outputTranscription?.text;
  if (outText) appendTranscript("agent", outText);

  // 3) Audio output → play, and reflect 'speaking' status.
  const parts = msg.serverContent?.modelTurn?.parts || [];
  for (const p of parts) {
    const inline = p.inlineData || p.inline_data;
    if (inline?.data && (inline.mimeType || inline.mime_type || "").startsWith("audio/")) {
      setState({ voiceStatus: "speaking" });
      player?.enqueue(base64ToArrayBuffer(inline.data));
    }
  }

  // 4) Turn boundaries.
  if (msg.serverContent?.interrupted) player?.flush(); // barge-in
  if (msg.serverContent?.turnComplete && getState().voiceActive) setState({ voiceStatus: "listening" });
}

// Wait for an in-flight tap lookup ('locating') to settle so the agent's target wording never
// cancels a selection the user is actively making. Bounded — a hung lookup can't stall edits.
async function settleSelection(maxMs = 6000) {
  const t0 = Date.now();
  while (getState().selection?.status === "locating" && Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 150));
  }
  return getState().selection;
}

// Drain the tool-call queue one editImage at a time. The handlingTool flag makes this a singleton
// loop: concurrent onmessage callbacks just append to the queue and let the running drain pick them
// up. Every call — including ones queued mid-edit — gets a sendToolResponse so no id is dropped.
async function drainToolCalls() {
  if (handlingTool) return; // a drain is already running; it will consume what we just pushed
  handlingTool = true;
  if (getState().voiceActive) setState({ voiceStatus: "thinking" });
  try {
    while (pendingToolCalls.length) {
      const fc = pendingToolCalls.shift();
      if (fc.name !== "editImage") {
        // Unknown tool: still answer the call so its id isn't left without a response.
        session?.sendToolResponse({
          functionResponses: [{ id: fc.id, name: fc.name, response: { result: "error", error: "unknown tool" } }],
        });
        continue;
      }
      const prompt = fc.args?.prompt || "";
      const targetWords = fc.args?.target;
      appendTranscript("tool", targetWords ? `editImage("${prompt}", target: "${targetWords}")` : `editImage("${prompt}")`);
      // Pass 8: a user's explicit tap selection always wins over the agent's wording — including
      // one still resolving: wait for an in-flight tap lookup to settle rather than cancel it.
      let selection = await settleSelection();
      if (selection?.status === "locating") {
        // Still resolving after the bounded wait (hung lookup). Never stomp the user's tap —
        // report busy instead of falling through to a query/unscoped edit.
        session?.sendToolResponse({
          functionResponses: [{
            id: fc.id,
            name: fc.name,
            response: { result: "error", error: "the user is still selecting an object — nothing was changed; retry in a moment" },
          }],
        });
        continue;
      }
      if (targetWords && selection?.status !== "active") {
        selection = await selectByQuery(targetWords);
        // The agent promised a single-object change. If we can't find that object, DON'T fall
        // back to silently repainting the whole room — report the miss so the agent can react.
        if (!selection) {
          session?.sendToolResponse({
            functionResponses: [{
              id: fc.id,
              name: fc.name,
              response: { result: "error", error: `could not locate "${targetWords}" in the photo — nothing was changed. Ask the user to tap the object, or retry without a target for a whole-room edit.` },
            }],
          });
          continue;
        }
      }
      const ok = await runEdit(prompt);
      session?.sendToolResponse({
        functionResponses: [
          { id: fc.id, name: fc.name, response: ok ? { result: "success", applied: prompt } : { result: "error" } },
        ],
      });
      // After a successful edit, send the updated image back so the agent can describe it (spec).
      if (ok) {
        const { activeImage } = getState();
        if (activeImage) await sendImageContext(session, activeImage, "Here is the updated room after that edit.");
      }
    }
  } finally {
    handlingTool = false;
    if (getState().voiceActive) setState({ voiceStatus: "listening" });
  }
}

// --- helpers ---

// Append a transcript entry, coalescing consecutive deltas from the same speaker.
function appendTranscript(role, text) {
  const list = getState().voiceTranscript.slice();
  const last = list[list.length - 1];
  if (last && last.role === role && role !== "tool") {
    list[list.length - 1] = { ...last, text: last.text + text };
  } else {
    list.push({ role, text, ts: Date.now() });
  }
  setState({ voiceTranscript: list });
}

// Send an image to a SPECIFIC session instance as a user content turn. Guarded against the
// instance being closed or superseded (stop/restart) while the blob is being read — re-reading
// the global `session` after an await could otherwise route the send into a newer session.
async function sendImageContext(target, blob, text) {
  if (!target || target !== session) return;
  const data = await blobToBase64(blob);
  if (target !== session) return; // stopped/superseded while reading the blob
  target.sendClientContent({
    turns: [{ role: "user", parts: [{ text }, { inlineData: { mimeType: blob.type || "image/jpeg", data } }] }],
  });
}

function friendlyMicError(err) {
  const name = err?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Microphone permission denied — allow mic access to use the voice assistant.";
  if (name === "NotFoundError") return "No microphone found.";
  return `Could not start the voice assistant: ${err?.message || err}`;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const r = String(reader.result);
      resolve(r.slice(r.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

// ArrayBuffer → base64 (chunked to avoid call-stack limits on large buffers).
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
