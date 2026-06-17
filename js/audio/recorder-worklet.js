// audio/recorder-worklet.js — AudioWorklet processor for mic capture.
//
// Runs on the audio thread (NOT the deprecated ScriptProcessorNode — H3). It accumulates mono
// Float32 samples and posts 16-bit PCM chunks to the main thread, which forwards them to the
// Live session. The AudioContext is created at 16 kHz, so samples here are already at the rate
// the Live API expects for input (audio/pcm;rate=16000).

class PCMRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this._target = 2048; // samples per posted chunk (~128ms at 16kHz)
    // Fixed-size Float32 accumulation buffer + write index. Reusing one typed array
    // (instead of growing a plain JS array with per-sample push) avoids per-frame GC
    // pressure on the audio thread, which can cause dropouts.
    this._buf = new Float32Array(this._target);
    this._idx = 0; // current write position within _buf
  }

  process(inputs) {
    const channel = inputs[0]?.[0]; // first input, first (mono) channel — Float32Array of 128
    if (channel) {
      let offset = 0; // read position within this 128-frame input block
      // Copy the input into the buffer, flushing whenever it fills. The loop handles
      // the case where a single input block straddles the chunk boundary (fill →
      // flush → keep filling with the remainder).
      while (offset < channel.length) {
        const remaining = this._target - this._idx; // space left in the buffer
        const count = Math.min(remaining, channel.length - offset);
        this._buf.set(channel.subarray(offset, offset + count), this._idx);
        this._idx += count;
        offset += count;

        if (this._idx === this._target) {
          // Buffer full: convert the accumulated Float32 samples to 16-bit PCM and
          // post (transferring the ArrayBuffer so there's no copy), then reset.
          const pcm = new Int16Array(this._target);
          for (let i = 0; i < this._target; i++) {
            const s = Math.max(-1, Math.min(1, this._buf[i])); // clamp
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff; // Float32 → Int16
          }
          this.port.postMessage(pcm.buffer, [pcm.buffer]); // transfer ownership (no copy)
          this._idx = 0;
        }
      }
    }
    return true; // keep the processor alive
  }
}

registerProcessor("pcm-recorder", PCMRecorder);
