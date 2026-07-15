# Pass 10 — Walk-Around Scan: Show the Agent Your Room, Live

**Goal ("Make It Real", part three):** during a voice session, tap **📷 Show the room** and pan
your phone around — the agent watches a live 1 fps camera stream and can discuss what it actually
sees, instead of being frozen on one photo.

## 1. User stories

- *As a user, mid-conversation I tap "Show the room", walk the camera around, and the agent
  acknowledges and tracks what it sees.*
- *As a user, I can ask "what would you change over here?" while pointing the camera.*
- *As a user, the scan ends when I tap stop (or automatically at its time cap) and the voice
  conversation simply continues.*

## 2. Acceptance criteria (verified live, 2026-07-14)

- [x] A "📷 Show the room" button appears in the voice panel only while a session is active;
      pressed state + "Stop showing" while streaming.
- [x] Frames stream at 1 fps (the Live API's documented max), downscaled to ≤768 px JPEG q0.7 —
      context, not art. Observed: 6 frames in ~6 s, 9+ on longer runs.
- [x] **The agent genuinely sees the stream** — forced-choice test against a synthetic camera
      (teal wall + orange traffic cone drawn on canvas): *"That's an orange traffic cone right
      there in the live view."*
- [x] Stop (button) halts the interval, stops all camera tracks, clears `scanActive`, and tells
      the agent the stream ended; the voice session survives. Session teardown also kills the
      scan (`stopVoiceSession → stopRoomScan("session")`).
- [x] Burst is capped at 45 s (audio+video Live sessions have a hard ~2-minute limit) — the timer
      self-stops with a "(ended automatically)" context note. *(Cap logic in place; the timeout
      path is code-verified — a 45 s live wait wasn't burned in testing.)*
- [x] Camera permission denial / no device degrades to a friendly toast; the session continues.
- [x] Zero new console errors across all scan runs.

## 3. Two empirical findings (the pass's real engineering)

1. **`sendRealtimeInput({ media })` is invisible to the model.** The SDK maps `media` to the
   legacy `mediaChunks[]` channel; 44 frames sent that way and the agent still said it couldn't
   view live camera frames. The dedicated **`video`** realtime field is the one that works.
2. **The 2.5 native-audio Live model ignores realtime video entirely.** Even via `video`, it
   answered forced-choice with "I don't see a bicycle, traffic cone…". Migrated `LIVE_MODEL` to
   **`gemini-3.1-flash-live-preview`** — the migration target the official docs name for exactly
   this model string — which is documented for "bidirectional voice and video agents" and passed
   the forced-choice test immediately.
   **Regression-checked after the swap:** transcripts, audio playback, and the Pass 8 tool bridge
   all work — the new model even combined targeting unprompted:
   `editImage("change the floor lamp from brass to matte black", target: "the gold floor lamp")`.

## 4. Risk register

| Risk | Mitigation | Outcome |
|------|------------|---------|
| R1: Audio+video session cap (~2 min) kills the voice session mid-scan | 45 s burst cap with auto-stop + agent notice | Session survived every scan in testing |
| R2: Live-model swap regresses the voice loop | Full regression of transcripts + tool bridge + targeting on the new model before shipping | Passed; behavior equivalent or better |
| R3: Frame uploads bloat the session / rate limits | 1 fps max, ≤768 px q0.7 JPEG, bursts not continuous mode | ~25-40 KB/frame observed |

## 5. File manifest

| File | Change | Why |
|------|--------|-----|
| `js/actions/voiceSession.js` | modified | `startRoomScan`/`stopRoomScan` (camera → 1 fps `video` realtime frames, session-bound, 45 s cap), LIVE_MODEL migration, scan teardown in stopVoiceSession |
| `js/components/voice-indicator.js` | modified | 📷 Show-the-room button (session-only, pressed state) |
| `js/state.js` | modified | `scanActive` (flat key) |
| `sw.js` | modified | Shell cache bump to v9 |
| `docs/passes/PASS_10.md` | added | This report |
| `README.md` | modified | Capability ledger entry |

## 6. Notes & carried forward

- The scan is deliberately a **burst**, not a mode — the 2-minute audio+video platform cap makes
  "always-on camera" impossible today; the UX frames it as "show the room", which fits.
- Frames are conversation context only; they are not captured into history and don't replace the
  working photo. "Adopt a scan frame as the new working photo" is a natural future slice.
- Live spoken audio in/out on the NEW model still deserves the standing human mic/speaker pass
  (same item carried since Pass 2); the text/tool/transcript paths are fully verified.
