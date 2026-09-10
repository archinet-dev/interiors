// analytics.js — safe custom-event wrapper for Replit-hosted Umami analytics.
// The tracker is injected only in published apps with analytics enabled, so calls are optional.
export function trackEvent(name, data) {
  try {
    window.umami?.track(name, data);
  } catch {
    // Analytics must never affect the app experience.
  }
}