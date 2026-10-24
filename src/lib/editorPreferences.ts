import { useSyncExternalStore } from "react";

type Preferences = { wrap?: boolean; sideBySide?: boolean; minimap?: boolean };
const key = "oiagent-editor-preferences";
const event = "oiagent-editor-preferences-changed";
let raw: string | null | undefined;
let cached: Preferences = {};
function read() {
  let value: string | null = null;
  try {
    value = localStorage.getItem(key);
  } catch {
    return cached;
  }
  if (value !== raw) {
    raw = value;
    try {
      const parsed = JSON.parse(value || "{}");
      cached = Object.fromEntries(
        ["wrap", "sideBySide", "minimap"]
          .filter((k) => typeof parsed?.[k] === "boolean")
          .map((k) => [k, parsed[k]]),
      );
    } catch {
      cached = {};
    }
  }
  return cached;
}
function subscribe(listener: () => void) {
  window.addEventListener(event, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(event, listener);
    window.removeEventListener("storage", listener);
  };
}
export function useEditorPreferences(defaultWrap = false) {
  const saved = useSyncExternalStore(subscribe, read, read);
  return {
    wrap: saved.wrap ?? defaultWrap,
    sideBySide: saved.sideBySide ?? true,
    minimap: saved.minimap ?? false,
    update(patch: Preferences) {
      const current = read();
      const previousRaw = raw;
      cached = { ...current, ...patch };
      raw = JSON.stringify(cached);
      try {
        localStorage.setItem(key, raw);
      } catch {
        // Keep the in-memory choice while storage remains at its previous value.
        raw = previousRaw;
      }
      window.dispatchEvent(new Event(event));
    },
  };
}
