// components/voice-indicator.js — <voice-indicator> custom element.
//
// The primary edit affordance: a mic toggle, a status display (idle/listening/thinking/speaking),
// and a running transcript of the conversation. It subscribes to state and reflects voiceStatus
// + voiceTranscript; clicking the mic starts/stops the Live session via the voiceSession action.

import { getState, subscribe } from "../state.js";
import { startVoiceSession, stopVoiceSession, startRoomScan, stopRoomScan } from "../actions/voiceSession.js";

const STATUS_LABEL = {
  idle: "Tap to talk",
  listening: "Listening…",
  thinking: "Editing…",
  speaking: "Speaking…",
};

const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host { display: block; }
  .panel {
    display: flex; flex-direction: column; gap: 12px;
    padding: 16px; border: 1px solid var(--line, #d4d4cf);
    border-radius: var(--radius-card, 14px); background: var(--frame, #fff);
  }
  .row { display: flex; align-items: center; gap: 12px; }
  .mic {
    width: 52px; height: 52px; border-radius: 50%; flex: 0 0 auto;
    border: 1.5px solid var(--accent, #36c); background: var(--accent-fill, #eef);
    color: var(--accent, #36c); font-size: 22px; cursor: pointer; display: grid; place-items: center;
  }
  .mic[aria-pressed="true"] { background: var(--accent, #36c); color: #fff; }
  .mic:focus-visible { outline: 2px solid var(--accent, #36c); outline-offset: 2px; }
  /* Walk-around scan (Pass 10): show the room to the agent, camera at 1 fps in a short burst. */
  .scan {
    margin-left: auto; flex: 0 0 auto;
    font: 600 12px/1 var(--font-sans, system-ui);
    color: var(--accent, #36c); background: var(--frame, #fff);
    border: 1.5px solid var(--accent, #36c); border-radius: 20px;
    padding: 9px 13px; cursor: pointer;
  }
  .scan[aria-pressed="true"] { background: var(--accent, #36c); color: #fff; }
  .scan[hidden] { display: none; }
  .scan:focus-visible { outline: 2px solid var(--accent, #36c); outline-offset: 2px; }
  .status { font: 600 13px/1.2 var(--font-sans, system-ui); color: var(--ink, #2c2c29); }
  .sub { font-size: 11px; color: var(--soft, #76766f); }
  /* Pulsing ring while listening (respects reduced motion below). */
  .mic[data-state="listening"] { animation: pulse 1.4s ease-out infinite; }
  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 color-mix(in oklch, var(--accent, #36c) 45%, transparent); }
    100% { box-shadow: 0 0 0 14px transparent; }
  }
  .transcript {
    display: flex; flex-direction: column; gap: 6px;
    max-height: 180px; overflow-y: auto; font-size: 13px;
  }
  .transcript:empty { display: none; }
  /* Chat bubbles (wireframe §C): user right + accent, agent left + tint, tool centered + muted. */
  .line { display: flex; flex-direction: column; max-width: 85%; line-height: 1.4; }
  .line .who { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); } /* sr-only */
  .line .text { padding: 7px 10px; border-radius: 12px; }
  .line.user { align-self: flex-end; }
  .line.user .text { background: var(--accent, #36c); color: #fff; border-bottom-right-radius: 4px; }
  .line.agent { align-self: flex-start; }
  .line.agent .text { background: var(--accent-fill, #eef); color: var(--ink, #2c2c29); border-bottom-left-radius: 4px; }
  .line.tool { align-self: center; max-width: 100%; }
  .line.tool .text { background: transparent; color: var(--soft, #76766f); font-style: italic; font-size: 11px; padding: 2px 0; }
  @media (prefers-reduced-motion: reduce) { .mic { animation: none !important; } }
`);

class VoiceIndicator extends HTMLElement {
  #unsub = null;
  #lastTranscriptLen = -1;
  #lastStatus = null;
  #lastVoiceActive = null;
  #onMicClick = null; // bound mic handler ref, so we can removeEventListener on disconnect
  #onScanClick = null; // bound scan handler ref (Pass 10)

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.adoptedStyleSheets = [sheet];
    root.innerHTML = `
      <div class="panel">
        <div class="row">
          <button class="mic" type="button" aria-pressed="false" aria-label="Toggle voice assistant">🎙️</button>
          <div>
            <div class="status">Tap to talk</div>
            <div class="sub">Voice assistant — describe a change out loud.</div>
          </div>
          <button class="scan" type="button" aria-pressed="false" hidden>📷 Show the room</button>
        </div>
        <div class="transcript" role="log" aria-live="polite"></div>
      </div>
    `;
    this.$mic = root.querySelector(".mic");
    this.$scan = root.querySelector(".scan");
    this.$status = root.querySelector(".status");
    this.$transcript = root.querySelector(".transcript");
  }

  connectedCallback() {
    // Define the bound handler once (idempotent across reconnects) so disconnectedCallback
    // can remove the exact same reference — otherwise listeners stack on reattach.
    this.#onMicClick ??= () => {
      const { voiceActive } = getState();
      if (voiceActive) stopVoiceSession();
      else startVoiceSession();
    };
    this.$mic.addEventListener("click", this.#onMicClick);
    this.#onScanClick ??= () => {
      if (getState().scanActive) stopRoomScan();
      else startRoomScan();
    };
    this.$scan.addEventListener("click", this.#onScanClick);
    this.#unsub = subscribe((s) => this.render(s));
    this.render(getState());
  }

  disconnectedCallback() {
    this.$mic.removeEventListener("click", this.#onMicClick); // mirror connectedCallback
    this.$scan.removeEventListener("click", this.#onScanClick);
    this.#unsub?.();
  }

  render(state) {
    // Status + mic pressed state (update only when status or active-ness actually changed).
    if (state.voiceStatus !== this.#lastStatus || state.voiceActive !== this.#lastVoiceActive) {
      this.$status.textContent = STATUS_LABEL[state.voiceStatus] || "Tap to talk";
      this.$mic.setAttribute("aria-pressed", String(state.voiceActive));
      this.$mic.dataset.state = state.voiceActive ? state.voiceStatus : "idle";
      this.#lastStatus = state.voiceStatus;
      this.#lastVoiceActive = state.voiceActive;
    }

    // Scan button (Pass 10): only offered during a live session; pressed while streaming.
    this.$scan.hidden = !state.voiceActive;
    this.$scan.setAttribute("aria-pressed", String(state.scanActive));
    this.$scan.textContent = state.scanActive ? "📷 Stop showing" : "📷 Show the room";

    // Transcript — re-render only when it grew/changed.
    if (state.voiceTranscript.length !== this.#lastTranscriptLen) {
      this.#renderTranscript(state.voiceTranscript);
      this.#lastTranscriptLen = state.voiceTranscript.length;
    } else if (state.voiceTranscript.length) {
      // Same count but last entry may have grown (coalesced delta) — refresh last line text.
      const last = state.voiceTranscript[state.voiceTranscript.length - 1];
      const lastEl = this.$transcript.lastElementChild;
      if (lastEl) lastEl.querySelector(".text").textContent = last.text;
    }
  }

  #renderTranscript(list) {
    this.$transcript.replaceChildren(); // clear without innerHTML
    for (const entry of list) {
      const line = document.createElement("div");
      line.className = `line ${entry.role}`;
      const who = document.createElement("span");
      who.className = "who";
      who.textContent = entry.role === "agent" ? "AI" : entry.role;
      const text = document.createElement("span");
      text.className = "text";
      text.textContent = entry.text; // textContent only (H3)
      line.append(who, text);
      this.$transcript.append(line);
    }
    this.$transcript.scrollTop = this.$transcript.scrollHeight;
  }
}

customElements.define("voice-indicator", VoiceIndicator);
