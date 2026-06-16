// audio/recorder-worklet.js — AudioWorklet processor for mic capture.
//
// Runs on the audio thread (NOT the deprecated ScriptProcessorNode — H3). It accumulates mono
// Float32 samples and posts 16-bit PCM chunks to the main thread, which forwards them to the
// Live session. The AudioContext is created at 16 kHz, so samples here are already at the rate
// the Live API expects for input (audio/pcm;rate=16000).

class PCMRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = [];
    this._target = 2048; // samples per posted chunk (~128ms at 16kHz)
  }

  process(inputs) {
    const channel = inputs[0]?.[0]; // first input, first (mono) channel — Float32Array of 128
    if (channel) {
      for (let i = 0; i < channel.length; i++) this._buf.push(channel[i]);
      if (this._buf.length >= this._target) {
        const pcm = new Int16Array(this._buf.length);
        for (let i = 0; i < this._buf.length; i++) {
          const s = Math.max(-1, Math.min(1, this._buf[i])); // clamp
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff; // Float32 → Int16
        }
        this.port.postMessage(pcm.buffer, [pcm.buffer]); // transfer ownership (no copy)
        this._buf = [];
      }
    }
    return true; // keep the processor alive
  }
}

registerProcessor("pcm-recorder", PCMRecorder);
