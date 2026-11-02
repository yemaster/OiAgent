import { useEffect, useId, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { call, desktop } from "@/lib/api";

type Status = {
  version: string | null;
  autoUpdate: boolean;
  checkedAt: number | null;
  error: string | null;
  runtimeReady: boolean;
};
export function QoderSdk() {
  const id = useId();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    void (async () => {
      try {
        const value = await call<Status>("qoder_sdk_status", {
          check: false,
          update: false,
        });
        if (disposed) return;
        setStatus(value);
        if (value.autoUpdate) {
          const checked = await call<Status>("qoder_sdk_status", {
            check: true,
            update: false,
          });
          if (!disposed) setStatus(checked);
        }
      } catch (e) {
        if (!disposed) setError(String(e));
      } finally {
        if (!disposed) setBusy(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);
  async function update(autoUpdate?: boolean) {
    setBusy(true);
    setError("");
    try {
      setStatus(
        await call<Status>("qoder_sdk_status", {
          check: autoUpdate === true,
          update: autoUpdate === undefined,
          autoUpdate,
        }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  if (!desktop) return null;
  const issue =
    error ||
    status?.error ||
    (status && !status.runtimeReady ? "需要 Node.js 18+" : "");
  return (
    <section
      aria-label="Qoder SDK"
      className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3 text-xs"
      aria-busy={busy}
    >
      <span className="shrink-0 whitespace-nowrap text-muted-foreground">
        SDK <span>{status?.version || (status ? "未安装" : "—")}</span>
      </span>
      <div
        role="status"
        aria-live="polite"
        className="flex min-w-0 flex-wrap items-center gap-2"
      >
        {issue ? (
          <span
            role="alert"
            className="max-w-40 truncate text-destructive"
            title={issue}
          >
            {issue}
          </span>
        ) : status?.version && status.checkedAt && !busy ? (
          <span className="whitespace-nowrap text-muted-foreground">
            已是最新版本
          </span>
        ) : null}
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => void update()}
        >
          {busy && <LoaderCircle className="size-3 motion-safe:animate-spin" />}
          {busy
            ? "正在检查…"
            : status?.version === null
              ? "安装 SDK"
              : "检查更新"}
        </Button>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Label
          htmlFor={id}
          className="whitespace-nowrap text-xs font-normal text-muted-foreground"
        >
          自动更新
        </Label>
        <Switch
          id={id}
          size="sm"
          aria-label="自动更新 SDK"
          checked={status?.autoUpdate ?? true}
          disabled={busy || !status}
          onCheckedChange={(value) => void update(value)}
        />
      </div>
    </section>
  );
}
