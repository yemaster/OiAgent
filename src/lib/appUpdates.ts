import { useEffect, useSyncExternalStore } from "react";
import { call, desktop } from "./api";

export interface AppUpdate {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  updateAvailable: boolean;
}
interface UpdateState {
  checking: boolean;
  result?: AppUpdate;
  error?: string;
}
let state: UpdateState = { checking: false };
let pending: Promise<void> | undefined;
let lastCheck = 0;
const listeners = new Set<() => void>();
const snapshot = () => state;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function publish(next: UpdateState) {
  state = next;
  listeners.forEach((listener) => listener());
}
export function checkAppUpdate() {
  if (pending) return pending;
  if (!desktop) return Promise.resolve();
  publish({ ...state, checking: true, error: undefined });
  pending = call<AppUpdate>("check_app_update")
    .then((result) => publish({ checking: false, result }))
    .catch((error) =>
      publish({ ...state, checking: false, error: String(error) }),
    )
    .finally(() => {
      lastCheck = Date.now();
      pending = undefined;
    });
  return pending;
}
export function useAppUpdate() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
// Defer network work until after startup; share requests with manual checks.
export function useBackgroundUpdateCheck() {
  useEffect(() => {
    if (!desktop) return;
    const interval = 6 * 60 * 60 * 1000;
    const check = () => {
      if (Date.now() - lastCheck >= interval) void checkAppUpdate();
    };
    const startup = setTimeout(check, 5000);
    const timer = setInterval(check, interval);
    return () => {
      clearTimeout(startup);
      clearInterval(timer);
    };
  }, []);
}
