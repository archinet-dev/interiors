// actions/voiceSession.js — the central mechanism: a live voice agent that sees the photo and
// edits it via function calling.
//
// Opens a Gemini Live session (through the Bun WS proxy — key stays server-side, H1), registers
// the editImage tool, streams mic audio up, plays the agent's audio down, mirrors transcripts into
// state, and routes tool calls to the real edit action. After each edit the new image is sent back
// so the agent can describe what changed (per the spec).

import { GoogleGenAI, Modality, Type } from "@google/genai";
import { getState, setState } from "../state.js";
import { runEdit } from "./editImage.js";
import { startMicCapture, PcmPlayer } from "../audio/audioIO.js";

// Native-audio Live model (verified available — see VERIFICATION_REPORT.md), held as a constant.
const LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

const SYSTEM_INSTRUCTION = `You are a friendly, concise interior-design assistant in a live voice conversation. You can SEE the user's room photo and any edited versions sent to you.

When the user asks for a change to the room, call the editImage tool with a CONCRETE, specific prompt that names the subject and the change — e.g. "replace the grey sofa with a tan leather sofa", "paint the walls sage green", "add a large potted fiddle-leaf fig in the empty corner". Preserve the room's geometry, perspective, and lighting. Do not call the tool for general chit-chat or questions.

After an edit completes you will receive the updated photo; describe what changed in ONE short spoken sentence. Keep all spoken replies brief and natural.`;

// One SDK instance, pointed at the proxy. The placeholder key is not a secret — the Bun proxy
// injects the real key into the upstream WebSocket.
const ai = new GoogleGenAI({
  apiKey: "managed-by-proxy",
  httpOptions: { baseUrl: `${location.origin}/api/genai` },
});

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
    },
    required: ["prompt"],
  },
};

let session = null;
let mic = null;
let player = null;
let handlingTool = false; // serialize tool-call handling across concurrent onmessage calls

// Open the Live session and start streaming the mic. Idempotent.
export async function startVoiceSession() {
  if (session) return;
  const { sourceImage } = getState();
  if (!sourceImage) {
    setState({ error: "Add a photo first, then start the voice assistant." });
    return;
  }

  try {
    setState({ voiceStatus: "listening", voiceActive: true, error: null, voiceTranscript: [] });
    player = new PcmPlayer();

    session = await ai.live.connect({
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
        onerror: (e) => {
          console.error("[voice] ws error:", e);
          setState({ error: "Voice connection error.", voiceStatus: "idle" });
        },
        onclose: (e) => console.log("[voice] session closed:", e?.reason || ""),
        onmessage: onLiveMessage,
      },
    });

    // Send the current photo as visual context on session start (spec).
    await sendImageContext(sourceImage, "Here is the room photo I'm working with.");

    // Start mic capture → stream PCM frames to the session.
    mic = await startMicCapture((pcmBuffer) => {
      if (!session) return;
      session.sendRealtimeInput({
        audio: { data: arrayBufferToBase64(pcmBuffer), mimeType: "audio/pcm;rate=16000" },
      });
    });
    // If the session was stopped while the mic permission dialog was up, don't leave it running.
    if (!session) {
      mic.stop();
      mic = null;
    }
  } catch (err) {
    // Expected user conditions (denied/no mic) are warnings; anything else is a real error.
    const expected = ["NotAllowedError", "SecurityError", "NotFoundError"].includes(err?.name);
    (expected ? console.warn : console.error)("[voice] could not start:", err?.name || err);
    setState({ error: friendlyMicError(err), voiceStatus: "idle", voiceActive: false });
    await stopVoiceSession();
  }
}

// Tear down everything cleanly.
export async function stopVoiceSession() {
  try { mic?.stop(); } catch {}
  try { player?.stop(); } catch {}
  try { session?.close(); } catch {}
  mic = null;
  player = null;
  session = null;
  handlingTool = false;
  setState({ voiceStatus: "idle", voiceActive: false });
}

// Send a text turn (used as a fallback and for automated testing of the tool-call bridge).
export function sendUserText(text) {
  if (!session) return;
  appendTranscript("user", text);
  session.sendClientContent({ turns: text });
}

// --- Live message handling ---

async function onLiveMessage(msg) {
  // 1) Tool call → run the real edit, report the result, then send the new image as context.
  //    Serialize across concurrent onmessage invocations so two edits can't interleave.
  const calls = msg.toolCall?.functionCalls;
  if (calls?.length && !handlingTool) {
    handlingTool = true;
    if (getState().voiceActive) setState({ voiceStatus: "thinking" });
    try {
      for (const fc of calls) {
        if (fc.name !== "editImage") continue;
        const prompt = fc.args?.prompt || "";
        appendTranscript("tool", `editImage("${prompt}")`);
        const ok = await runEdit(prompt);
        session?.sendToolResponse({
          functionResponses: [
            { id: fc.id, name: fc.name, response: ok ? { result: "success", applied: prompt } : { result: "error" } },
          ],
        });
        if (ok) {
          const { activeImage } = getState();
          if (activeImage) await sendImageContext(activeImage, "Here is the updated room after that edit.");
        }
      }
    } finally {
      handlingTool = false;
      if (getState().voiceActive) setState({ voiceStatus: "listening" });
    }
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

// Send an image to the agent as a user content turn so it can ground its suggestions.
async function sendImageContext(blob, text) {
  if (!session) return;
  const data = await blobToBase64(blob);
  session.sendClientContent({
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
