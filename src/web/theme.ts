import { useSyncExternalStore } from "react";

export type ThemePref = "light" | "dark" | "system";

const KEY = "oor-theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function read(): ThemePref {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

let pref = read();

/** Resolve the preference and put it on <html data-theme>, which the CSS (and Hexclave's components) key off. */
function apply() {
  const mode = pref === "system" ? (media.matches ? "dark" : "light") : pref;
  document.documentElement.dataset.theme = mode;
}

export function initTheme() {
  apply();
  media.addEventListener("change", () => {
    apply();
    for (const l of listeners) l();
  });
}

export function setTheme(next: ThemePref) {
  pref = next;
  if (next === "system") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, next);
  apply();
  for (const l of listeners) l();
}

export function useThemePref() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pref,
  );
}
