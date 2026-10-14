import { useEffect, useEffectEvent, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { toast } from "sonner";
import { call, desktop } from "@/lib/api";

export function useProjectDrop(
  onOpen: (project: string) => void,
  blocked: () => boolean,
) {
  const [dragging, setDragging] = useState(false);
  const open = useEffectEvent(onOpen);
  const isBlocked = useEffectEvent(blocked);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let busy = false;
    const subscription = getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (disposed) return;
      if (payload.type === "enter") {
        setDragging(payload.paths.length === 1 && !busy && !isBlocked());
      } else if (payload.type === "leave") {
        setDragging(false);
      } else if (payload.type === "drop") {
        setDragging(false);
        if (busy) return;
        if (isBlocked()) {
          toast.error("请先关闭当前对话框");
          return;
        }
        if (payload.paths.length !== 1) {
          toast.error("请一次拖入一个文件夹");
          return;
        }
        busy = true;
        // The backend checks that the path exists, is a directory, and deduplicates it.
        void call<string>("add_project", { project: payload.paths[0] })
          .then((project) => {
            if (!disposed && !isBlocked()) open(project);
          })
          .catch((error) => {
            if (!disposed) toast.error(String(error));
          })
          .finally(() => {
            busy = false;
          });
      }
    });
    void subscription.catch((error) => {
      if (!disposed) toast.error(String(error));
    });
    return () => {
      disposed = true;
      void subscription.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);
  return dragging;
}
