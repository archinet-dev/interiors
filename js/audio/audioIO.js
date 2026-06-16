// audio/audioIO.js — microphone capture and PCM playback for the Live voice session.
//
// Capture: getUserMedia(audio) → AudioContext@16kHz → AudioWorklet → Int16 PCM chunks.
// Playback: schedule 24kHz Int16 PCM chunks from the model back-to-back so speech is gapless.
// (The @google/genai SDK handles the protocol; we handle the raw audio in/out per the spec.)

const RECORD_RATE = 16000; // Live API input rate
const PLAYBACK_RATE = 24000; // Live API native-audio output rate

// Start capturing the mic. Calls onPcmChunk(ArrayBuffer of Int16) for each chunk.
// Returns a handle with stop(). Throws if permission denied / no device (caller handles).
export async function startMicCapture(onPcmChunk) {
  const ctx = new AudioContext({ sampleRate: RECORD_RATE });
  await ctx.audioWorklet.addModule("js/audio/recorder-worklet.js");

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    video: false,
  });

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-recorder");
  node.port.onmessage = (e) => onPcmChunk(e.data);
  source.connect(node);
  // Intentionally NOT connected to destination — we don't want to hear our own mic.

  return {
    stop() {
      try { node.port.onmessage = null; node.disconnect(); source.disconnect(); } catch {}
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    },
  };
}

// Plays a stream of 24kHz Int16 PCM chunks gaplessly using a scheduling cursor.
export class PcmPlayer {
  constructor(rate = PLAYBACK_RATE) {
    this.ctx = new AudioContext({ sampleRate: rate });
    this.rate = rate;
    this.nextTime = 0;
    this.sources = new Set();
  }

  enqueue(arrayBuffer) {
    const int16 = new Int16Array(arrayBuffer);
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 0x8000; // Int16 → Float32
    const buffer = this.ctx.createBuffer(1, f32.length, this.rate);
    buffer.copyToChannel(f32, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ctx.destination);
    const now = this.ctx.currentTime;
    if (this.nextTime < now) this.nextTime = now; // catch up if we fell behind
    src.start(this.nextTime);
    this.nextTime += buffer.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  // Cut playback short (e.g. on barge-in or stop).
  flush() {
    for (const s of this.sources) { try { s.stop(); } catch {} }
    this.sources.clear();
    this.nextTime = 0;
  }

  stop() {
    this.flush();
    this.ctx.close().catch(() => {});
  }
}
