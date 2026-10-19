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
    let dragSequence = 0;
    const subscription = getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (disposed) return;
      if (payload.type === "enter") {
        const sequence = ++dragSequence;
        setDragging(false);
        if (payload.paths.length === 1 && !busy && !isBlocked()) {
          void call<string>("classify_attachment_drop", {
            paths: payload.paths,
          })
            .then((kind) => {
              if (!disposed && sequence === dragSequence && !isBlocked())
                setDragging(kind === "directory");
            })
            .catch(() => {});
        }
      } else if (payload.type === "leave") {
        dragSequence++;
        setDragging(false);
      } else if (payload.type === "drop") {
        dragSequence++;
        setDragging(false);
        if (busy) return;
        if (isBlocked()) {
          toast.error("请先关闭当前对话框");
          return;
        }
        busy = true;
        const point = payload.position;
        const target = document.elementFromPoint(
          point.x / window.devicePixelRatio,
          point.y / window.devicePixelRatio,
        );
        // Route by actual filesystem type, never by extension. Folder drops
        // retain project navigation; file drops belong to the hovered composer.
        void call<string>("classify_attachment_drop", { paths: payload.paths })
          .then(async (kind) => {
            if (disposed || isBlocked()) return;
            if (kind === "files") {
              const composer =
                target
                  ?.closest("[data-composer-container]")
                  ?.querySelector("[data-attachment-target]") ||
                target?.closest("[data-attachment-target]");
              if (!composer) {
                toast.error("请将文件拖到消息输入框");
                return;
              }
              composer.dispatchEvent(
                new CustomEvent("oiagent-attach-files", {
                  detail: payload.paths,
                }),
              );
            } else {
              const project = await call<string>("add_project", {
                project: payload.paths[0],
              });
              if (!disposed && !isBlocked()) open(project);
            }
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
