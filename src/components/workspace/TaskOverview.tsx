import { useMemo, type ReactNode } from "react";
import { CheckCircle2, Circle, LoaderCircle, Target } from "lucide-react";
import { type Task, compact, tokens, statusLabels } from "@/lib/types";
import {
  describeTool,
  plain,
  record,
  type TranscriptItem,
} from "@/lib/transcript";
import { cn } from "@/lib/utils";

export function TaskOverview({
  task,
  timeline,
  children,
  git,
}: {
  task: Task;
  timeline: TranscriptItem[];
  children: ReactNode;
  git?: ReactNode;
}) {
  const plan = useMemo(() => {
    // Only the owning Agent's latest plan belongs in this task overview.
    for (let i = timeline.length - 1; i >= 0; i--) {
      const item = timeline[i];
      if (item.kind !== "tool" || describeTool(item.tool).kind !== "plan")
        continue;
      const input = record(item.tool.input);
      const rows = input.plan || input.todos || input.items;
      if (Array.isArray(rows))
        return rows
          .map((value) => {
            const row = record(value);
            return {
              text: plain(row.step || row.content || row.text || value),
              done: row.status === "completed" || row.completed === true,
              running: row.status === "in_progress",
            };
          })
          .filter((row) => row.text);
    }
    return [];
  }, [timeline]);
  return (
    <div className="divide-y divide-border/70 px-5 text-sm [&>section]:py-4">
      {git}
      {children && (
        <section className="space-y-2">
          <h3 className="pr-6 text-xs font-medium text-muted-foreground">
            会话
          </h3>
          {children}
        </section>
      )}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">目标</h3>
          <span
            className={cn(
              "text-xs",
              task.status === "completed"
                ? "text-emerald-700 dark:text-emerald-400"
                : task.status === "running"
                  ? "text-sky-700 dark:text-sky-400"
                  : "text-muted-foreground",
            )}
          >
            {statusLabels[task.status]}
          </span>
        </div>
        <div className="flex items-start gap-2">
          <Target className="mt-1 size-4 shrink-0 text-primary/80" />
          <p className="break-words leading-relaxed">{task.title}</p>
        </div>
        <div className="flex gap-3 text-xs text-muted-foreground">
          {!!plan.length && (
            <span>
              {plan.filter((row) => row.done).length}/{plan.length}
            </span>
          )}
          {task.usage.known && <span>{compact(tokens(task))} tokens</span>}
        </div>
      </section>
      {!!plan.length && (
        <section className="space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground">计划</h3>
          <div
            role="progressbar"
            aria-label="计划完成进度"
            aria-valuemin={0}
            aria-valuemax={plan.length}
            aria-valuenow={plan.filter((row) => row.done).length}
            className="h-1 overflow-hidden rounded-full bg-foreground/10"
          >
            <div
              className="h-full rounded-full bg-emerald-600 transition-[width] duration-200 motion-reduce:transition-none dark:bg-emerald-400"
              style={{
                width: `${(plan.filter((row) => row.done).length / plan.length) * 100}%`,
              }}
            />
          </div>
          <ul className="space-y-3">
            {plan.map((row, index) => (
              <li key={index} className="flex items-start gap-2">
                {row.done ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
                ) : row.running ? (
                  <LoaderCircle className="mt-0.5 size-4 shrink-0 text-sky-700 motion-safe:animate-spin dark:text-sky-400" />
                ) : (
                  <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <span
                  className={cn(
                    "break-words text-xs leading-5",
                    row.done && "text-muted-foreground line-through",
                  )}
                >
                  {row.text}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
