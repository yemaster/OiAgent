import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { RefreshCw } from "lucide-react";
import { call, desktop } from "@/lib/api";

/** Transport progress updates independently of the (potentially large) transcript. */
export function LiveTaskStatus({
  id,
  active,
}: {
  id: string;
  active: boolean;
}) {
  const [status, setStatus] = useState<{
    id: string;
    text: string | null;
  } | null>(null);
  useEffect(() => {
    if (!active || !desktop) return;
    let disposed = false;
    let received = false;
    let off: (() => void) | undefined;
    void listen<{ id: string; text: string | null }>(
      "task-live-status",
      ({ payload }) => {
        if (!disposed && payload.id === id) {
          received = true;
          setStatus(payload);
        }
      },
    )
      .then(async (unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        off = unlisten;
        const text = await call<string | null>("task_live_status", { id });
        // An event received during the request is newer than its snapshot.
        if (!disposed && !received) setStatus({ id, text });
      })
      .catch(() => {});
    return () => {
      disposed = true;
      off?.();
    };
  }, [id, active]);
  if (!active || status?.id !== id || !status.text) return null;
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 px-5 py-2 text-xs text-muted-foreground"
    >
      <RefreshCw className="size-3.5 shrink-0 motion-safe:animate-spin" />
      <span className="truncate" title={status.text}>
        {status.text}
      </span>
    </div>
  );
}
