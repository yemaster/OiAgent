import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { call, desktop } from "@/lib/api";
import { rememberDevices, remoteTask, type RemoteDevice } from "@/lib/lan";
import type { Task } from "@/lib/types";
export function useRemoteDevices() {
  const [ready, setReady] = useState(!desktop);
  const [devices, setDevices] = useState<RemoteDevice[]>([]);
  const state = useRef<RemoteDevice[]>([]);
  const pending = useRef<Promise<RemoteDevice[]> | null>(null);
  const refresh = useCallback(async (afterMutation = false) => {
    if (!desktop) return;
    if (pending.current) {
      await pending.current.catch(() => {});
      if (!afterMutation) return;
    }
    try {
      const request = call<RemoteDevice[]>("lan_remote_snapshots");
      pending.current = request;
      const result = await request;
      const next = result.map((d) => ({
        ...d,
        snapshot:
          d.snapshot || state.current.find((p) => p.id === d.id)?.snapshot,
      }));
      state.current = next;
      rememberDevices(next);
      setDevices(next);
    } finally {
      setReady(true);
      pending.current = null;
    }
  }, []);
  useEffect(() => {
    if (!desktop) return;
    void refresh().catch(() => {});
    const poll = () => {
      if (!document.hidden) void refresh().catch(() => {});
    };
    const timer = setInterval(poll, 5000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [refresh]);
  const upsert = useCallback((task: Task) => {
    const next = state.current.map((d) =>
      d.id === task.deviceId && d.snapshot
        ? {
            ...d,
            snapshot: {
              ...d.snapshot,
              tasks: [
                { ...task, id: task.id.slice(`lan:${d.id}:`.length) },
                ...d.snapshot.tasks.filter(
                  (t) => `lan:${d.id}:${t.id}` !== task.id,
                ),
              ],
            },
          }
        : d,
    );
    state.current = next;
    rememberDevices(next);
    setDevices(next);
  }, []);
  const tasks = useMemo(
    () =>
      devices.flatMap((d) =>
        (d.snapshot?.tasks || []).map((t) => remoteTask(t, d.id)),
      ),
    [devices],
  );
  return {
    ready,
    devices,
    refresh,
    upsert,
    tasks,
  };
}
