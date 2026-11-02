import { useState } from "react";
import { LoaderCircle, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ContextUsage as Usage } from "@/lib/types";
import { compact } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ContextUsage({
  usage,
  model,
  disabledReason,
  compressing,
  onCompact,
  onOpenChange,
}: {
  usage?: Usage | null;
  model: string;
  disabledReason?: string;
  compressing: boolean;
  onCompact: () => Promise<void>;
  onOpenChange?: (open: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const working = pending || compressing;
  const used =
    usage?.input == null ? undefined : usage.input + (usage.output || 0);
  const capacity = usage?.window && usage.window > 0 ? usage.window : undefined;
  const percent =
    usage?.ratio != null &&
    Number.isFinite(usage.ratio) &&
    usage.ratio >= 0 &&
    usage.ratio <= 1
      ? Math.round(usage.ratio * 100)
      : used !== undefined && capacity
        ? Math.round((used / capacity) * 100)
        : undefined;
  async function compress() {
    if (working || disabledReason) return;
    setPending(true);
    setError("");
    try {
      await onCompact();
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  }
  const count = (value: number | null | undefined) =>
    value == null ? "未上报" : value.toLocaleString();
  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="上下文用量"
          className="flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded px-1 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span
            role="progressbar"
            aria-label="上下文占用"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={
              percent === undefined ? undefined : Math.min(100, percent)
            }
            aria-valuetext={
              working
                ? "正在压缩"
                : percent === undefined
                  ? "用量未知"
                  : `${percent}%`
            }
            className="h-1.5 w-16 overflow-hidden rounded-full bg-foreground/10"
          >
            {percent !== undefined && !working && (
              <span
                className={cn(
                  "block h-full rounded-full",
                  percent >= 90
                    ? "bg-amber-500"
                    : "bg-emerald-600/70 dark:bg-emerald-400/70",
                )}
                style={{ width: `${Math.min(100, percent)}%` }}
              />
            )}
          </span>
          {working
            ? "压缩中…"
            : percent !== undefined
              ? `${percent}%`
              : used !== undefined
                ? `${compact(used)} tokens`
                : "上下文 —"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-72 gap-3 rounded-xl p-4"
        aria-label="上下文详情"
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-medium">上下文</h3>
          <span
            className="max-w-40 truncate text-xs text-muted-foreground"
            title={model}
          >
            {model === "默认模型" ? "" : model}
          </span>
        </div>
        <dl className="space-y-2 text-xs [&>div]:flex [&>div]:justify-between [&>div]:gap-3 [&_dt]:text-muted-foreground [&_dd]:tabular-nums">
          <div>
            <dt>已使用</dt>
            <dd>
              {count(used)}
              {used !== undefined ? " tokens" : ""}
            </dd>
          </div>
          <div>
            <dt>上下文容量</dt>
            <dd>{count(capacity)}</dd>
          </div>
          <div>
            <dt>输入 / 输出</dt>
            <dd>
              {count(usage?.input)} / {count(usage?.output)}
            </dd>
          </div>
          <div>
            <dt>其中缓存输入</dt>
            <dd>{count(usage?.cached)}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          {usage?.ratio != null && used === undefined
            ? "Agent 仅上报上下文占用比例"
            : "最近一次模型调用的用量"}
        </p>
        <div className="space-y-2 border-t pt-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={working || !!disabledReason}
            onClick={() => void compress()}
          >
            {working ? (
              <LoaderCircle className="motion-safe:animate-spin" />
            ) : (
              <Minimize2 />
            )}
            {working ? "正在压缩上下文" : "压缩上下文"}
          </Button>
          {!working && disabledReason && (
            <p className="text-xs text-muted-foreground">{disabledReason}</p>
          )}
          {error && (
            <p role="alert" className="break-words text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
