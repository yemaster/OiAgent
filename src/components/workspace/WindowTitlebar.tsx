import { useEffect, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, Copy, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { desktop } from "@/lib/api";
import { TitlebarMenu } from "./TitlebarMenu";
import { BrandMark } from "./BrandMark";

export function WindowTitlebar({
  compact = false,
  actions,
}: {
  compact?: boolean;
  actions?: ReactNode;
}) {
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
  // Keep the fixed CSS-pixel height in sync with window_chrome.rs.
  return (
    <div
      data-tauri-drag-region
      aria-label="窗口控制栏"
      className={`relative flex shrink-0 select-none items-center bg-sidebar text-muted-foreground ${mac ? "h-16" : "h-12"}`}
    >
      {mac ? (
        <div className="w-24 shrink-0" aria-hidden="true" />
      ) : (
        <>
          <BrandMark className="mx-3 size-4 shrink-0" />
          <TitlebarMenu />
        </>
      )}

      {!compact && mac && (
        <BrandMark className="mr-1 size-4 text-muted-foreground" />
      )}
      {!compact && (
        <span
          data-tauri-drag-region
          className="shrink-0 px-2 text-xs font-medium text-foreground/80"
        >
          OiAgent
        </span>
      )}
      {actions}
      <div data-tauri-drag-region className="h-full flex-1" />
      {!mac && (
        <div
          role="group"
          aria-label="窗口按钮"
          className="flex h-full shrink-0 items-stretch"
        >
          <Button
            variant="ghost"
            className="h-full w-[46px] shrink-0 rounded-none border-0 p-0 active:translate-y-0"
            aria-label="最小化窗口"
            onClick={() => perform(() => getCurrentWindow().minimize())}
          >
            <Minus className="size-3.5" strokeWidth={1.5} />
          </Button>
          <Button
            variant="ghost"
            className="h-full w-[46px] shrink-0 rounded-none border-0 p-0 active:translate-y-0"
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
            className="h-full w-[46px] shrink-0 rounded-none border-0 p-0 hover:bg-destructive hover:text-white active:translate-y-0"
            aria-label="关闭窗口"
            onClick={() => perform(() => getCurrentWindow().close())}
          >
            <X className="size-3.5" strokeWidth={1.5} />
          </Button>
        </div>
      )}
    </div>
  );
}
