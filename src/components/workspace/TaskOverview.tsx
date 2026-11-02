import { useMemo } from "react";
import { CheckCircle2, Circle, LoaderCircle, ChevronRight } from "lucide-react";
import type { TranscriptItem } from "@/lib/transcript";
import { latestTaskPlan } from "@/lib/taskPlan";
import { cn } from "@/lib/utils";

export function TaskOverview({
  timeline,
  hideEmpty = false,
  onNavigate,
}: {
  timeline: TranscriptItem[];
  hideEmpty?: boolean;
  onNavigate?: (key: string) => void;
}) {
  const plan = useMemo(() => latestTaskPlan(timeline), [timeline]);
  if (!plan.rows.length)
    return hideEmpty ? null : (
      <p className="text-xs text-muted-foreground">Agent 尚未提供计划</p>
    );
  const title = (
    <>
      <span className="flex-1 text-left">计划</span>
      <span className="tabular-nums">
        {plan.rows.filter((row) => row.done).length}/{plan.rows.length}
      </span>
      {onNavigate && <ChevronRight className="size-3.5" />}
    </>
  );
  return (
    <section aria-label="执行计划" className="space-y-3">
      {onNavigate ? (
        <button
          type="button"
          onClick={() => onNavigate(plan.key)}
          className="flex w-full items-center gap-2 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {title}
        </button>
      ) : (
        <h3 className="flex items-center gap-2 text-sm text-muted-foreground">
          {title}
        </h3>
      )}
      <ul className="space-y-2.5">
        {plan.rows.slice(0, onNavigate ? 4 : undefined).map((row, index) => (
          <li key={index} className="flex items-start gap-2.5">
            {row.done ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : row.running ? (
              <LoaderCircle className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400 motion-safe:animate-spin" />
            ) : (
              <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <span
              className={cn(
                "line-clamp-2 break-words text-sm leading-5",
                row.done && "text-muted-foreground line-through",
              )}
              title={row.text}
            >
              {row.text}
            </span>
          </li>
        ))}
      </ul>
      {onNavigate && (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => onNavigate(plan.key)}
        >
          查看完整计划
        </button>
      )}
    </section>
  );
}
