// components/camera-capture.js — <camera-capture> custom element.
//
// Provides four ways to get a room photo into the app:
//   1. Camera   — getUserMedia → <video> preview → freeze a frame to <canvas> → Blob.
//                 (Deliberately NOT ImageCapture: it isn't Baseline — Safari has no support. R1.)
//   2. Upload   — <input type="file" accept="image/*">.
//   3. Drag/drop— drop an image file onto the surface.
//   4. Sample   — load the bundled room photo (deterministic; great for testing/demos).
//
// On success it dispatches a composed `photo` CustomEvent carrying the Blob. It never writes to
// state directly — main.js owns that via the setPhoto action.

const SAMPLE_IMAGE_URL = "assets/sample-room.jpg";

// Constructable stylesheet (Baseline). Custom properties inherit through the shadow boundary,
// so the page's design tokens (var(--accent), etc.) work inside here.
const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host { display: block; }
  .surface {
    display: flex; flex-direction: column; align-items: center; gap: 14px;
    padding: 22px 18px;
    background: var(--frame, #fff);
    border: 1.5px dashed var(--dash, #b7b7b1);
    border-radius: var(--radius-card, 14px);
    text-align: center;
  }
  .surface.dragover { border-color: var(--accent, #36c); background: var(--accent-fill, #eef); }
  .hint { color: var(--soft, #76766f); font-size: 13px; margin: 0; }
  .controls { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
  button {
    font: 600 13px/1 var(--font-sans, system-ui);
    border-radius: var(--radius-btn, 8px);
    padding: 10px 16px; cursor: pointer;
    border: 1.5px solid var(--line2, #a0a09a);
    background: var(--frame, #fff); color: var(--ink, #2c2c29);
  }
  button.primary { color: var(--accent, #36c); background: var(--accent-fill, #eef); border-color: var(--accent, #36c); }
  button:focus-visible { outline: 2px solid var(--accent, #36c); outline-offset: 2px; }
  .preview-wrap { width: 100%; border-radius: var(--radius-card, 14px); overflow: hidden; background: #000; }
  video { display: block; width: 100%; height: auto; }
  .msg { color: var(--bad, #b00); font-size: 13px; margin: 0; min-height: 0; }
  .msg:empty { display: none; }
  [hidden] { display: none !important; }
`);

class CameraCapture extends HTMLElement {
  #stream = null; // active MediaStream, so we can stop tracks on teardown (R2)

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.adoptedStyleSheets = [sheet];
    root.innerHTML = `
      <div class="surface" part="surface">
        <p class="hint">Take a photo of your room, upload one, or drag an image here.</p>

        <div class="preview-wrap" hidden>
          <video playsinline muted></video>
        </div>

        <div class="controls" data-view="idle">
          <button type="button" class="primary" data-act="camera">Use camera</button>
          <button type="button" data-act="upload">Upload photo</button>
          <button type="button" data-act="sample">Use sample</button>
        </div>

        <div class="controls" data-view="live" hidden>
          <button type="button" class="primary" data-act="shoot">Capture</button>
          <button type="button" data-act="cancel">Cancel</button>
        </div>

        <p class="msg" role="status"></p>
        <input type="file" accept="image/*" hidden />
      </div>
    `;

    // Cache element references.
    this.$surface = root.querySelector(".surface");
    this.$previewWrap = root.querySelector(".preview-wrap");
    this.$video = root.querySelector("video");
    this.$idle = root.querySelector('[data-view="idle"]');
    this.$live = root.querySelector('[data-view="live"]');
    this.$msg = root.querySelector(".msg");
    this.$file = root.querySelector('input[type="file"]');
  }

  connectedCallback() {
    // Delegate clicks from both control rows.
    this.shadowRoot.addEventListener("click", (e) => {
      const act = e.target?.dataset?.act;
      if (act) this.#onAction(act);
    });

    // File upload.
    this.$file.addEventListener("change", () => {
      const file = this.$file.files?.[0];
      if (file) this.#useFile(file);
      this.$file.value = ""; // allow re-selecting the same file
    });

    // Drag-and-drop.
    this.$surface.addEventListener("dragover", (e) => {
      e.preventDefault();
      this.$surface.classList.add("dragover");
    });
    this.$surface.addEventListener("dragleave", () => this.$surface.classList.remove("dragover"));
    this.$surface.addEventListener("drop", (e) => {
      e.preventDefault();
      this.$surface.classList.remove("dragover");
      const file = e.dataTransfer?.files?.[0];
      if (file) this.#useFile(file);
    });
  }

  disconnectedCallback() {
    this.#stopStream();
  }

  // --- actions ---

  #onAction(act) {
    this.#setMsg("");
    if (act === "camera") this.#startCamera();
    else if (act === "upload") this.$file.click();
    else if (act === "sample") this.#useSample();
    else if (act === "shoot") this.#captureFrame();
    else if (act === "cancel") this.#stopCamera();
  }

  async #startCamera() {
    try {
      // Prefer the rear camera on phones; fall back to any camera.
      this.#stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      this.$video.srcObject = this.#stream;
      await this.$video.play();
      this.#showLiveView(true);
    } catch (err) {
      // R2: denial / no device must NOT throw uncaught or freeze. Keep upload + sample working.
      console.warn("[camera-capture] camera unavailable:", err?.name || err);
      this.#setMsg("Camera unavailable or permission denied — upload a photo or use the sample instead.");
      this.#showLiveView(false);
    }
  }

  #captureFrame() {
    const v = this.$video;
    if (!v.videoWidth) {
      this.#setMsg("Camera not ready yet — try again.");
      return;
    }
    // Draw the current video frame to a canvas, then export a JPEG Blob (R1 path).
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d").drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        this.#stopCamera();
        if (blob) this.#emitPhoto(blob);
        else this.#setMsg("Could not capture the frame — try again.");
      },
      "image/jpeg",
      0.92
    );
  }

  async #useSample() {
    try {
      const res = await fetch(SAMPLE_IMAGE_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.#emitPhoto(await res.blob());
    } catch (err) {
      console.warn("[camera-capture] sample load failed:", err);
      this.#setMsg("Could not load the sample image.");
    }
  }

  #useFile(file) {
    // R3: only accept images.
    if (!file.type.startsWith("image/")) {
      this.#setMsg("That file isn't an image. Please choose a JPEG or PNG.");
      return;
    }
    this.#emitPhoto(file);
  }

  // --- helpers ---

  #emitPhoto(blob) {
    this.dispatchEvent(new CustomEvent("photo", { detail: { blob }, bubbles: true, composed: true }));
  }

  #showLiveView(live) {
    this.$previewWrap.hidden = !live;
    this.$live.hidden = !live;
    this.$idle.hidden = live;
  }

  #stopCamera() {
    this.#stopStream();
    this.$video.srcObject = null;
    this.#showLiveView(false);
  }

  #stopStream() {
    this.#stream?.getTracks().forEach((t) => t.stop());
    this.#stream = null;
  }

  #setMsg(text) {
    this.$msg.textContent = text; // textContent only — never innerHTML (H3)
  }
}

customElements.define("camera-capture", CameraCapture);
