import { useCallback, useEffect, useRef, useState } from "react";
import { call, desktop } from "@/lib/api";
import { rememberDevices, remoteTask, type RemoteDevice } from "@/lib/lan";
import type { Task } from "@/lib/types";
export function useRemoteDevices() {
  const [devices, setDevices] = useState<RemoteDevice[]>([]);
  const state = useRef<RemoteDevice[]>([]);
  const busy = useRef(false);
  const refresh = useCallback(async () => {
    if (!desktop || busy.current) return;
    busy.current = true;
    try {
      const result = await call<RemoteDevice[]>("lan_remote_snapshots");
      const next = result.map((d) => ({
        ...d,
        snapshot:
          d.snapshot || state.current.find((p) => p.id === d.id)?.snapshot,
      }));
      state.current = next;
      rememberDevices(next);
      setDevices(next);
    } finally {
      busy.current = false;
    }
  }, []);
  useEffect(() => {
    void refresh().catch(() => {});
    const timer = setInterval(() => void refresh().catch(() => {}), 5000);
    return () => clearInterval(timer);
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
  return {
    devices,
    refresh,
    upsert,
    tasks: devices.flatMap((d) =>
      (d.snapshot?.tasks || []).map((t) => remoteTask(t, d.id)),
    ),
  };
}
