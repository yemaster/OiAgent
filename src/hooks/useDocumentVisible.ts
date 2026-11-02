import { useSyncExternalStore } from "react";

const subscribe = (notify: () => void) => {
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
};
const visible = () => document.visibilityState !== "hidden";

/** Suspend background polling without discarding the visible page's state. */
export function useDocumentVisible() {
  return useSyncExternalStore(subscribe, visible, () => true);
}
