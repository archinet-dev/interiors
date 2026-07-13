# Pass 2 — Voice Tool Call (the central mechanism)

**Capability:** "User speaks a request, the Live agent (which sees the photo) decides to edit, the
edit runs via function calling, and the agent narrates the result."

This is the bridge the whole product hinges on: the Live voice agent calls a registered `editImage`
tool, which runs the real Nano-Banana edit, updates state, and feeds the new image back to the agent.

## Pre-code verification (done — see agent spike)
- Live WS URL: `wss://generativelanguage.googleapis.com/ws/...BidiGenerateContent?key=…`. SDK derives
  `ws://` from an `http://` `baseUrl`, and puts the key in a `?key=` query param.
- Bun reverse-proxies the WS: `server.upgrade(req,{data})` + a `websocket` handler that pipes to an
  upstream global `WebSocket(...?key=REAL)`. Key stays server-side (H1).
- Turns can be driven by **text** (`sendClientContent({turns})`) — used to verify the bridge without a mic.

## (a) Acceptance Criteria
```
[ ] Mic toggle in <voice-indicator>; no console errors on load.
[ ] Clicking it opens a Live session through the Bun WS proxy (voiceStatus → listening). Proxy logs
    a ws connection; the browser never holds the key (ws URL key is a placeholder).
[ ] The current photo is sent as visual context on session start.
[ ] A request to edit (verified via an injected TEXT turn "add a plant") triggers a tool call →
    a real edit runs → activeImage updates → the agent receives the result.
[ ] Transcript (input + output captions) renders into state.voiceTranscript and is shown.
[ ] voiceStatus reflects idle/listening/thinking/speaking and the indicator shows each.
[ ] Stopping the mic closes the session cleanly (tracks stopped, ws closed, status → idle).
[ ] Permission denied / no mic → friendly message, status idle, no uncaught error.
[ ] Every new file reachable from index.html / its modules.
```

## (b) Risk Register
```
R1. Live agent calls editImage with a vague prompt → poor edit. Mitigation: tool schema requires a
    concrete `prompt` string; system instruction tells it to pass a concrete subject + change verb,
    grounded in the photo it sees.
R2. WS proxy mishandles binary/text frames or upstream-not-open races → broken session. Mitigation:
    forward text-as-text / binary-as-binary, set upstream binaryType='arraybuffer', buffer client
    frames until upstream opens (per the verified Bun pattern).
R3. Mic permission denied / no device → app appears frozen. Mitigation: try/catch getUserMedia,
    set voiceStatus='idle' + a message, keep the rest of the app usable; stop tracks on stop.
R4. Audio PCM plumbing (16k in / 24k out via AudioWorklet) is hard to test headless. Mitigation:
    verify the tool-call BRIDGE with a text turn in automation; mark live audio I/O as code-verified
    + manual (same honesty as Pass 1's camera).
```

## (c) File Manifest
| File | Add/Mod | Justification |
|------|---------|---------------|
| `server/index.js` | mod | Add the Live WebSocket reverse-proxy (upgrade + `websocket` handlers → upstream wss with real key injected). |
| `js/actions/voiceSession.js` | add | Open/close the Live session; register the `editImage` tool; route toolCall → `runEdit`; send photo context; pump transcripts → state; manage voiceStatus. |
| `js/audio/recorder-worklet.js` | add | AudioWorklet processor: Float32 → Int16 PCM chunks posted to the main thread (no ScriptProcessorNode — H3). |
| `js/audio/audioIO.js` | add | Mic capture (16 kHz) feeding the worklet, and a PCM player that schedules 24 kHz output chunks. |
| `js/components/voice-indicator.js` | add | `<voice-indicator>` custom element: mic toggle, status display, live transcript; subscribes to state. |
| `index.html` | mod | Include `<voice-indicator>` + its module. |
| `js/state.js` | mod | Add `voiceActive` flag (status keys already in the shape). |
| `styles.css` | mod | Minor: position the voice indicator. |

## Pass Report

**Verified in-browser on 2026-06-16** (Playwright against the Bun server, real Gemini Live API).

### 1. Capability added
A live voice agent that sees the photo, decides to edit via a registered `editImage` function call,
runs the real edit, feeds the new image back, and narrates — bridged by the Bun WebSocket proxy.

### 2. Files touched
`server/index.js` (Live WS reverse-proxy), `js/actions/voiceSession.js` (session + tool bridge +
transcripts + audio), `js/audio/recorder-worklet.js` (AudioWorklet PCM capture), `js/audio/audioIO.js`
(mic capture 16k + PCM player 24k), `js/components/voice-indicator.js` (mic/status/transcript element),
`js/actions/editImage.js` (runEdit returns success), `js/state.js` (`voiceActive`), `index.html`
(element + script), `styles.css` (n/a — element styles are in its shadow sheet).

### 3. Acceptance criteria — pass/fail
```
[x] Mic toggle in <voice-indicator>; no console errors on load.
[x] Toggling opens a Live session THROUGH the Bun WS proxy (proxy logs "[ws] client connected →
    opening upstream"); the browser ws URL key is a placeholder (real key injected server-side).
[x] Current photo sent as visual context on session start. (sendImageContext on connect)
[x] An edit request (text turn "add a plant") → toolCall editImage → real edit runs → activeImage
    changes. Verified BOTH standalone (toolCall received) AND via the real app path
    (imageChangedByToolCall: true; agent then narrates).
[x] Transcript (user + agent + tool) renders into state.voiceTranscript. (captured: user/agent/tool)
[x] voiceStatus reflects listening→thinking→speaking→listening; indicator shows it.
[x] Stopping closes cleanly: status idle, voiceActive false, tracks/ws closed (proxy logs disconnect).
[x] Mic denied → friendly message, status idle, no UNCAUGHT error (handled; warn-level log).
[~] Live AUDIO in/out (mic speech → agent speech) is code-verified (AudioWorklet 16k capture, 24k
    PCM playback) but needs a manual test with a real mic/speakers — headless has no audio device.
[x] All new files reachable from index.html / its modules.
```

### 4. Decisions made
- **WS reverse-proxy in the same Bun server.** The SDK derives `ws://` from the `http://` baseUrl
  and puts the key in `?key=`; the proxy strips the placeholder and injects the real key into the
  upstream `wss://…?key=…`. Text-as-text / binary-as-binary, upstream `binaryType='arraybuffer'`,
  client frames buffered until upstream opens.
- **AudioWorklet (not ScriptProcessorNode, H3)** for 16 kHz PCM capture; a scheduling PCM player for
  gapless 24 kHz output; barge-in flushes playback on `interrupted`.
- **`sendUserText` export** as a text fallback and to make the tool-call bridge testable without a mic.
- **After each edit, the new image is sent back** as a user content turn so the agent can describe
  what changed (spec).
- **Reused `runEdit`** (now returns success) so voice and button edits share one code path.

### 5. Risks carried forward
- **Live audio I/O** not exercised under automation (no mic/speakers) — manual verification needed.
- **Barge-in / long-session stability** (heartbeat, reconnect on network drop) only minimally handled
  — revisit in Pass 5 polish (error toasts + recovery).
- **Budgets** (Lighthouse a11y ≥95, 4G first paint, 50-edit memory) still to be measured (Pass 5).

### 6. Capability ledger
Updated in `README.md` (Pass 2 section).
