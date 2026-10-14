import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Menu, Minus, Square, Copy, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { call, desktop } from "@/lib/api";

export function WindowTitlebar() {
  const mac = /Mac/i.test(navigator.platform);
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!desktop || mac) return;
    const window = getCurrentWindow();
    let stopped = false;
    const sync = () =>
      void window
        .isMaximized()
        .then((value) => {
          if (!stopped) setMaximized(value);
        })
        .catch(() => {});
    sync();
    const listener = window.onResized(sync);
    return () => {
      stopped = true;
      void listener.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [mac]);
  if (!desktop) return null;
  const perform = (action: () => Promise<unknown>) =>
    void action().catch((error) => toast.error(String(error)));
  return (
    <div
      data-tauri-drag-region
      aria-label="窗口控制栏"
      className="flex h-8 shrink-0 select-none items-center bg-sidebar text-muted-foreground"
    >
      {mac ? (
        <div className="w-24 shrink-0" aria-hidden="true" />
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-1 rounded-sm"
          aria-label="应用菜单"
          onClick={() => perform(() => call("show_application_menu"))}
        >
          <Menu className="size-4" />
        </Button>
      )}
      <div data-tauri-drag-region className="h-full min-w-12 flex-1" />
      {!mac && (
        <div className="flex h-full">
          <Button
            variant="ghost"
            className="h-full w-11 rounded-none"
            aria-label="最小化窗口"
            onClick={() => perform(() => getCurrentWindow().minimize())}
          >
            <Minus className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            className="h-full w-11 rounded-none"
            aria-label={maximized ? "还原窗口" : "最大化窗口"}
            onClick={() => perform(() => getCurrentWindow().toggleMaximize())}
          >
            {maximized ? (
              <Copy className="size-3" />
            ) : (
              <Square className="size-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            className="h-full w-11 rounded-none hover:bg-destructive hover:text-white"
            aria-label="关闭窗口"
            onClick={() => perform(() => getCurrentWindow().close())}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
