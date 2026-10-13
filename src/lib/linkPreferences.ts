import { useSyncExternalStore } from "react";

const key = "oiagent-confirm-external-links";
const event = "oiagent-link-preferences-changed";

export function confirmExternalLinks(): boolean {
  try {
    return localStorage.getItem(key) !== "false";
  } catch {
    return true;
  }
}

export function setConfirmExternalLinks(value: boolean) {
  localStorage.setItem(key, String(value));
  window.dispatchEvent(new Event(event));
}

function subscribe(listener: () => void) {
  window.addEventListener(event, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(event, listener);
    window.removeEventListener("storage", listener);
  };
}

export function useConfirmExternalLinks() {
  return useSyncExternalStore(subscribe, confirmExternalLinks, () => true);
}
