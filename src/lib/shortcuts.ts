import { useSyncExternalStore } from "react";

export const sendShortcuts = [
  { value: "mod-enter", label: "⌘ / Ctrl + Enter" },
  { value: "enter", label: "Enter" },
  { value: "alt-enter", label: "Alt + Enter" },
] as const;
export type SendShortcut = (typeof sendShortcuts)[number]["value"];
const key = "oiagent-send-shortcut";
const event = "oiagent-shortcuts-changed";
function read(): SendShortcut {
  try {
    const value = localStorage.getItem(key);
    return (
      sendShortcuts.find((item) => item.value === value)?.value ?? "mod-enter"
    );
  } catch {
    return "mod-enter";
  }
}
function subscribe(listener: () => void) {
  window.addEventListener(event, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(event, listener);
    window.removeEventListener("storage", listener);
  };
}
export function useSendShortcut() {
  return useSyncExternalStore(subscribe, read, () => "mod-enter" as const);
}
export function setSendShortcut(value: SendShortcut) {
  localStorage.setItem(key, value);
  window.dispatchEvent(new Event(event));
}
export function sendShortcutLabel(value: SendShortcut) {
  return sendShortcuts.find((s) => s.value === value)!.label;
}
export function matchesSendShortcut(
  e: {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    repeat: boolean;
    isComposing?: boolean;
    keyCode?: number;
  },
  shortcut: SendShortcut,
) {
  if (
    e.key !== "Enter" ||
    e.shiftKey ||
    e.repeat ||
    e.isComposing ||
    e.keyCode === 229
  )
    return false;
  if (shortcut === "enter") return !e.ctrlKey && !e.metaKey && !e.altKey;
  if (shortcut === "alt-enter") return e.altKey && !e.ctrlKey && !e.metaKey;
  return (e.ctrlKey || e.metaKey) && !e.altKey;
}
