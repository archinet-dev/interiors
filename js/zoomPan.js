// zoomPan.js — pinch-zoom + pan for the active room image (wireframe §B/C: "Pinch-zoom + pan on
// mobile"). Pointer-based, so touch pinches and desktop drag/double-click both work.
//
// The image keeps transform-origin at center; the transform is `translate(tx,ty) scale(s)`, so the
// rendered offset of a point from center is `t + s·(localOffset)`. Pinch keeps the gesture midpoint
// stationary by solving for `t` from that relation. Pan is only active while zoomed in. The zoom
// resets whenever the image changes (the <img> 'load' fires on each edit swap).

const MIN = 1;
const MAX = 4;

// `target` receives the transform (Pass 8: the .canvas-wrap holding image + selection overlay,
// so both move together); `img` is the <img> whose load event resets the zoom. Passing the same
// element for both preserves the original behavior.
export function attachZoomPan(container, target, img = target) {
  let scale = 1;
  let tx = 0;
  let ty = 0;
  const pointers = new Map(); // pointerId -> {x, y}

  // Gesture start state.
  let startDist = 0;
  let startScale = 1;
  let startTx = 0;
  let startTy = 0;
  let startX = 0; // single-pointer pan anchor
  let startY = 0;
  let center = { x: 0, y: 0 }; // container center (screen coords) captured at gesture start

  const apply = () => {
    target.style.transform = scale === 1 ? "" : `translate(${tx}px, ${ty}px) scale(${scale})`;
    container.style.cursor = scale > 1 ? "grab" : "";
    // When zoomed, trap all touch gestures so one-finger drag pans (not scrolls). At 1×, use pan-y:
    // the page still scrolls vertically with one finger, but a two-finger pinch is delivered to our
    // handlers instead of being hijacked by the browser — so pinch works even starting from 1×.
    container.style.touchAction = scale > 1 ? "none" : "pan-y";
  };

  // Seed the touch-action immediately (never leave it at the default `auto`, or a pinch that starts
  // from 1× is decided by the browser before our JS can react).
  container.style.touchAction = "pan-y";

  const reset = () => {
    scale = 1;
    tx = 0;
    ty = 0;
    apply();
  };

  // Clamp pan so the scaled image still covers the container (origin = center).
  const clampPan = () => {
    const r = container.getBoundingClientRect();
    const maxX = ((scale - 1) * r.width) / 2;
    const maxY = ((scale - 1) * r.height) / 2;
    tx = Math.max(-maxX, Math.min(maxX, tx));
    ty = Math.max(-maxY, Math.min(maxY, ty));
  };

  const captureCenter = () => {
    const r = container.getBoundingClientRect();
    center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  container.addEventListener("pointerdown", (e) => {
    // Track the pointer first; capture is best-effort (it throws if the pointer isn't "active").
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { container.setPointerCapture(e.pointerId); } catch {}
    const pts = [...pointers.values()];
    if (pointers.size === 2) {
      captureCenter();
      startDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      startScale = scale;
      startTx = tx;
      startTy = ty;
    } else if (pointers.size === 1 && scale > 1) {
      startX = e.clientX;
      startY = e.clientY;
      startTx = tx;
      startTy = ty;
      container.style.cursor = "grabbing";
    }
  });

  container.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.values()];

    if (pointers.size === 2) {
      e.preventDefault();
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const next = Math.max(MIN, Math.min(MAX, startScale * (dist / startDist)));
      // Keep the pinch midpoint stationary: midpoint offset from center, in screen space.
      const midX = (pts[0].x + pts[1].x) / 2 - center.x;
      const midY = (pts[0].y + pts[1].y) / 2 - center.y;
      const localX = (midX - startTx) / startScale;
      const localY = (midY - startTy) / startScale;
      scale = next;
      tx = midX - scale * localX;
      ty = midY - scale * localY;
      clampPan();
      apply();
    } else if (pointers.size === 1 && scale > 1) {
      e.preventDefault();
      tx = startTx + (e.clientX - startX);
      ty = startTy + (e.clientY - startY);
      clampPan();
      apply();
    }
  });

  const end = (e) => {
    pointers.delete(e.pointerId);
    try { container.releasePointerCapture(e.pointerId); } catch {}
    // If a pinch ends with one finger still down, re-seed the pan anchors from the remaining
    // pointer (and current translate) so the continuing one-finger pan doesn't jump.
    if (pointers.size === 1 && scale > 1) {
      const [p] = pointers.values();
      startX = p.x;
      startY = p.y;
      startTx = tx;
      startTy = ty;
      container.style.cursor = "grabbing";
      return;
    }
    if (scale <= MIN + 0.02) reset();
    else container.style.cursor = "grab";
  };
  container.addEventListener("pointerup", end);
  container.addEventListener("pointercancel", end);

  // Double-tap / double-click toggles zoom (centered).
  container.addEventListener("dblclick", () => {
    if (scale > 1) reset();
    else { scale = 2.5; tx = 0; ty = 0; clampPan(); apply(); }
  });

  // Reset zoom whenever a new image loads (each edit swaps img.src).
  img.addEventListener("load", reset);
}
