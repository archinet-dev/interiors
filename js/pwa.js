// pwa.js — register the service worker (installable, offline shell).
// The SW only caches the navigation shell; all inference traffic (/api/*) bypasses it.

if ("serviceWorker" in navigator) {
  addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then(
      (reg) => console.log("[pwa] service worker registered:", reg.scope),
      (err) => console.warn("[pwa] service worker registration failed:", err)
    );
  });
}
