// theme.js — light/dark theme toggle with persistence.
//
// Default: follow the OS (prefers-color-scheme), achieved by leaving no [data-theme] attribute so
// the tokens' light-dark() resolves against the system color-scheme. The toggle cycles
// system → light → dark and persists the explicit choice in localStorage (a small UI pref).

const KEY = "smv-theme"; // 'light' | 'dark' | (absent = follow system)
const root = document.documentElement;
const button = document.getElementById("theme-toggle");

const ICON = { light: "☀️", dark: "🌙", system: "🌗" };

// Apply a stored choice ('light'/'dark') or clear it to follow the system.
function apply(choice) {
  if (choice === "light" || choice === "dark") root.dataset.theme = choice;
  else delete root.dataset.theme;
  updateButton(choice);
}

function updateButton(choice) {
  if (!button) return;
  const mode = choice || "system";
  button.textContent = ICON[mode];
  button.setAttribute("aria-label", `Theme: ${mode} (tap to change)`);
  button.title = `Theme: ${mode}`;
}

// Read the stored choice, sanitizing it: only 'light'/'dark' are valid explicit
// choices — anything else (corrupt/legacy value) collapses to null so we follow
// the system and never feed an unknown key into ICON[mode] (which would be undefined).
function readStored() {
  const value = localStorage.getItem(KEY);
  return value === "light" || value === "dark" ? value : null;
}

// Initialize from storage.
apply(readStored());

// Cycle system → light → dark → system on click.
button?.addEventListener("click", () => {
  const current = readStored() || "system"; // sanitized read; corrupt value -> system
  const next = current === "system" ? "light" : current === "light" ? "dark" : "system";
  if (next === "system") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, next);
  apply(next === "system" ? null : next);
});
