import { useEffect, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, Copy, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { desktop } from "@/lib/api";
import { BrandMark } from "./BrandMark";

export function WindowTitlebar({ actions }: { actions?: ReactNode }) {
  const mac = /Mac/i.test(navigator.platform);
  if (!desktop) return null;
  // The parent adds an 8px top inset, aligned with the main content header.
  return (
    <div
      data-tauri-drag-region
      aria-label="窗口控制栏"
      className="relative flex h-12 shrink-0 select-none items-center bg-sidebar text-muted-foreground"
    >
      {mac ? (
        <div className="w-24 shrink-0" aria-hidden="true" />
      ) : (
        <BrandMark className="mx-5 size-4 shrink-0" />
      )}

      {mac && <BrandMark className="mr-1 size-4 text-muted-foreground" />}
      <span
        data-tauri-drag-region
        className="min-w-0 truncate px-2 text-xs font-medium text-foreground/80"
      >
        OiAgent
      </span>
      {actions}
      <div data-tauri-drag-region className="h-full flex-1" />
    </div>
  );
}

export function WindowControls() {
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
  if (!desktop || mac) return null;
  const perform = (action: () => Promise<unknown>) =>
    void action().catch((error) => toast.error(String(error)));
  return (
    <div
      role="group"
      aria-label="窗口按钮"
      className="flex h-full shrink-0 items-stretch text-muted-foreground"
    >
      <Button
        variant="ghost"
        className="h-full! w-[46px] shrink-0 rounded-none border-0 p-0 active:translate-y-0"
        aria-label="最小化窗口"
        onClick={() => perform(() => getCurrentWindow().minimize())}
      >
        <Minus className="size-3.5" strokeWidth={1.5} />
      </Button>
      <Button
        variant="ghost"
        className="h-full! w-[46px] shrink-0 rounded-none border-0 p-0 active:translate-y-0"
        aria-label={maximized ? "还原窗口" : "最大化窗口"}
        onClick={() => perform(() => getCurrentWindow().toggleMaximize())}
      >
        {maximized ? (
          <Copy className="size-3.5" strokeWidth={1.5} />
        ) : (
          <Square className="size-3.5" strokeWidth={1.5} />
        )}
      </Button>
      <Button
        variant="ghost"
        className="h-full! w-[46px] shrink-0 rounded-none border-0 p-0 hover:bg-destructive hover:text-white active:translate-y-0"
        aria-label="关闭窗口"
        onClick={() => perform(() => getCurrentWindow().close())}
      >
        <X className="size-3.5" strokeWidth={1.5} />
      </Button>
    </div>
  );
}
