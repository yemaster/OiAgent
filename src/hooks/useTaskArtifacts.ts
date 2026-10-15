import { useCallback, useEffect, useSyncExternalStore } from "react";
import { call } from "@/lib/api";
export type Artifact = {
  path: string;
  project: string;
  relativePath: string;
  stepIds: string[];
  size: number;
  error: string | null;
};
export type ArtifactList = { files: Artifact[]; truncated: boolean };
type State = {
  data?: ArtifactList;
  error?: string;
  loading: boolean;
  revision: number;
};
const empty: State = { loading: false, revision: 0 };
const cache = new Map<
  string,
  {
    state: State;
    listeners: Set<() => void>;
    pending?: Promise<void>;
    checked: number;
  }
>();
function entry(key: string) {
  let item = cache.get(key);
  if (!item) {
    // Keep only inactive entries in the bounded cache eviction pool.
    if (cache.size >= 32)
      for (const [id, old] of cache)
        if (!old.listeners.size && !old.pending) {
          cache.delete(id);
          break;
        }
    item = { state: empty, listeners: new Set(), checked: 0 };
    cache.set(key, item);
  }
  return item;
}
function request(kind: "task" | "workflow", id: string, force = false) {
  const item = entry(`${kind}:${id}`);
  if (item.pending) return item.pending;
  if (!force && Date.now() - item.checked < 5000) return Promise.resolve();
  const publish = (state: State) => {
    item.state = state;
    item.listeners.forEach((listener) => listener());
  };
  publish({ ...item.state, loading: true });
  item.pending = call<ArtifactList>(`${kind}_artifacts`, { id })
    .then((data) => {
      if (!data?.files) throw new Error("无法读取产物");
      publish({ data, loading: false, revision: item.state.revision + 1 });
    })
    .catch((error) =>
      publish({ ...item.state, loading: false, error: String(error) }),
    )
    .finally(() => {
      item.pending = undefined;
      item.checked = Date.now();
    });
  return item.pending;
}
export function useTaskArtifacts(
  kind: "task" | "workflow",
  id: string,
  enabled: boolean,
  version: string | number,
  live = false,
) {
  const key = `${kind}:${id}`;
  const subscribe = useCallback(
    (listener: () => void) => {
      const item = entry(key);
      item.listeners.add(listener);
      return () => {
        item.listeners.delete(listener);
      };
    },
    [key],
  );
  const snapshot = useCallback(() => entry(key).state, [key]);
  const state = useSyncExternalStore(subscribe, snapshot, () => empty);
  useEffect(() => {
    if (!enabled) return;
    void request(kind, id);
    // A trailing fetch catches changes even when a short task completes inside the cache TTL.
    const timeout = setTimeout(() => void request(kind, id), 5100);
    const timer = live
      ? setInterval(() => void request(kind, id), 5100)
      : undefined;
    return () => {
      clearTimeout(timeout);
      clearInterval(timer);
    };
  }, [kind, id, enabled, version, live]);
  return { ...state, refresh: () => request(kind, id, true) };
}
