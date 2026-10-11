import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { call, desktop } from "@/lib/api";
import {
  automaticClose,
  type CloseInfo,
  type CloseBehavior,
} from "@/lib/lifecycle";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Choice } from "./shared";

export function CloseApplication({ dirtyFiles }: { dirtyFiles: number }) {
  const [info, setInfo] = useState<CloseInfo | null>(null);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const dirty = useRef(dirtyFiles);
  useLayoutEffect(() => {
    dirty.current = dirtyFiles;
  }, [dirtyFiles]);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let loading = false;
    let again = false;
    const check = async () => {
      if (loading) {
        again = true;
        return;
      }
      loading = true;
      try {
        const next = await call<CloseInfo>("close_info");
        if (disposed || !next.pending) return;
        const automatic = automaticClose(next, dirty.current);
        if (automatic) {
          try {
            await call("apply_close", {
              action: automatic,
              remember: false,
              confirmed: false,
            });
          } catch (e) {
            setInfo(await call<CloseInfo>("close_info"));
            toast.error(String(e));
          }
        } else {
          setRemember(false);
          setInfo(next);
        }
      } catch (e) {
        toast.error(String(e));
      } finally {
        loading = false;
        if (again && !disposed) {
          again = false;
          void check();
        }
      }
    };
    const off = listen("app-close-requested", () => void check());
    void off
      .then(() => {
        if (!disposed) void check();
      })
      .catch((e) => toast.error(String(e)));
    return () => {
      disposed = true;
      void off.then((fn) => fn()).catch(() => {});
    };
  }, []);
  const showing = info !== null;
  useEffect(() => {
    if (!showing) return;
    let disposed = false;
    const timer = setInterval(() => {
      void call<CloseInfo>("close_info")
        .then((next) => {
          if (!disposed)
            setInfo(
              (previous) =>
                previous && {
                  ...previous,
                  running: next.running,
                  trayAvailable: next.trayAvailable,
                },
            );
        })
        .catch(() => {});
    }, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [showing]);
  async function choose(action: "cancel" | "tray" | "quit") {
    setBusy(true);
    try {
      await call("apply_close", {
        action,
        remember: action !== "cancel" && remember && info?.pending === "close",
        confirmed: action === "quit",
      });
      if (remember && info?.pending === "close" && action !== "cancel")
        window.dispatchEvent(new Event("oiagent-close-preferences-changed"));
      setInfo(null);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={!!info}
      onOpenChange={(open) => {
        if (!open && !busy) void choose("cancel");
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {info?.pending === "quit" ? "退出 OiAgent？" : "关闭 OiAgent 窗口"}
          </DialogTitle>
          <DialogDescription className={info?.running ? undefined : "sr-only"}>
            {info?.running
              ? `${info.running} 个任务运行中，退出将停止任务。`
              : "选择关闭方式。"}
          </DialogDescription>
        </DialogHeader>
        {dirtyFiles > 0 && (
          <p role="alert" className="text-sm text-destructive">
            {dirtyFiles} 个文件未保存，退出将丢弃修改。
          </p>
        )}
        {info?.pending === "close" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="remember-close"
                checked={remember}
                onCheckedChange={(v) => setRemember(v === true)}
                disabled={busy}
              />
              <Label htmlFor="remember-close">记住此选择</Label>
            </div>
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            className="sm:mr-auto"
            disabled={busy}
            onClick={() => void choose("cancel")}
          >
            取消
          </Button>
          {info?.trayAvailable && (
            <Button disabled={busy} onClick={() => void choose("tray")}>
              最小化到托盘
            </Button>
          )}
          <Button
            variant={info?.running || dirtyFiles ? "destructive" : "outline"}
            disabled={busy}
            onClick={() => void choose("quit")}
          >
            {info?.running
              ? "退出并停止任务"
              : dirtyFiles
                ? "不保存并退出"
                : "退出应用"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CloseSettings() {
  const [info, setInfo] = useState<CloseInfo | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    const update = () => {
      void call<CloseInfo>("close_info")
        .then((value) => {
          if (!disposed) setInfo(value);
        })
        .catch((e) => toast.error(String(e)));
    };
    update();
    window.addEventListener("oiagent-close-preferences-changed", update);
    return () => {
      disposed = true;
      window.removeEventListener("oiagent-close-preferences-changed", update);
    };
  }, []);
  if (!desktop) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 py-5">
      <div>
        <Label>关闭窗口时</Label>
        <p className="mt-2 text-xs text-muted-foreground">
          退出时若有运行任务或未保存文件，仍会提示。
        </p>
        {info && !info.trayAvailable && (
          <p className="mt-1 text-xs text-muted-foreground">
            当前系统托盘不可用。
          </p>
        )}
      </div>
      <Choice
        label="关闭窗口时"
        value={info?.behavior || "ask"}
        disabled={!info || busy}
        options={[
          { value: "ask", label: "每次询问" },
          ...(info?.trayAvailable
            ? [{ value: "tray", label: "最小化到托盘" }]
            : []),
          { value: "quit", label: "退出应用" },
        ]}
        onChange={(value) => {
          setBusy(true);
          void call("set_close_behavior", { behavior: value })
            .then(() =>
              setInfo(
                (prev) => prev && { ...prev, behavior: value as CloseBehavior },
              ),
            )
            .catch((e) => toast.error(String(e)))
            .finally(() => setBusy(false));
        }}
      />
    </div>
  );
}
