import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { call, desktop } from "@/lib/api";
import type { Schedule, ScheduleDefinition } from "@/lib/schedules";
export function useSchedules(enabled: boolean) {
  const [items, setItems] = useState<Schedule[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const pending = useRef<Promise<void> | null>(null);
  const [editors, setEditors] = useState<Record<string, ScheduleDefinition>>(
    {},
  );
  const [editorId, setEditorId] = useState<string | null>(null);
  const refresh = useCallback(() => {
    if (pending.current) return pending.current;
    const request = call<Schedule[]>("schedule_catalog")
      .then((items) => {
        setItems(items);
        setError("");
        setLoaded(true);
      })
      .catch((e) => {
        setError(String(e));
        throw e;
      })
      .finally(() => {
        pending.current = null;
      });
    pending.current = request;
    return request;
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let off: (() => void) | undefined;
    const fetch = () => {
      if (!document.hidden) void refresh().catch(() => {});
    };
    fetch();
    const timer = window.setInterval(fetch, 15000);
    if (desktop)
      void listen("schedules-changed", fetch)
        .then((unlisten) => {
          if (disposed) unlisten();
          else off = unlisten;
        })
        .catch(() => {});
    document.addEventListener("visibilitychange", fetch);
    return () => {
      disposed = true;
      clearInterval(timer);
      off?.();
      document.removeEventListener("visibilitychange", fetch);
    };
  }, [enabled, refresh]);
  function open(definition: ScheduleDefinition) {
    const existing =
      definition.id &&
      Object.entries(editors).find(([, def]) => def.id === definition.id)?.[0];
    const id = existing || crypto.randomUUID();
    if (!existing)
      setEditors((old) => ({ ...old, [id]: structuredClone(definition) }));
    setEditorId(id);
  }
  function update(id: string, definition: ScheduleDefinition) {
    setEditors((old) => ({ ...old, [id]: definition }));
  }
  return {
    items,
    error,
    loaded,
    refresh,
    open,
    update,
    editors,
    editorId,
    setEditorId,
    editor: editorId ? editors[editorId] : undefined,
  };
}
