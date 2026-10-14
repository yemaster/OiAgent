import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { call } from "@/lib/api";
import type { Agent } from "@/lib/types";

type Quota = {
  updatedAt: number;
  windows: {
    label: string;
    usedPercent: number;
    resetsAt: number | null;
    remaining: number | null;
    unit: string | null;
  }[];
};
export function AgentQuota({ agent }: { agent: Agent }) {
  const [data, setData] = useState<Quota | null>(null);
  useEffect(() => {
    if (
      !agent.available ||
      agent.custom ||
      !["codex", "qodercn", "claude"].includes(agent.kind)
    )
      return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const value = await call<Quota | null>("agent_quota", { id: agent.id });
        if (!disposed) setData(value);
      } catch {
        if (!disposed) setData(null);
      } finally {
        if (!disposed) timer = setTimeout(load, 60_000);
      }
    }
    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [
    agent.id,
    agent.kind,
    agent.available,
    agent.custom,
    agent.executable,
    agent.version,
  ]);
  if (!data?.windows.length) return null;
  return (
    <section
      aria-label="账户配额"
      className="mt-4 space-y-3 border-t pt-3"
      title={`更新于 ${new Date(data.updatedAt * 1000).toLocaleTimeString()}`}
    >
      {data.windows.map((window, index) => (
        <div key={`${window.label}:${index}`} className="space-y-1.5">
          <div className="flex justify-between gap-2 text-xs">
            <span className="truncate text-muted-foreground">
              {window.label}
            </span>
            <span className="shrink-0 tabular-nums">
              已用 {Math.round(window.usedPercent)}%
            </span>
          </div>
          <Progress
            value={window.usedPercent}
            aria-label={`${window.label}配额已用`}
          />
          {(window.remaining !== null || window.resetsAt !== null) && (
            <div className="flex flex-wrap justify-between gap-x-3 text-[11px] text-muted-foreground">
              {window.remaining !== null && (
                <span>
                  剩余 {window.remaining.toLocaleString()} {window.unit}
                </span>
              )}
              {window.resetsAt !== null && (
                <span>
                  {new Date(window.resetsAt * 1000).toLocaleString(undefined, {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  重置
                </span>
              )}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
