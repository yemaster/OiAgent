import { useMemo, type ReactNode } from "react";
import { CheckCircle2, Circle, LoaderCircle } from "lucide-react";
import { type Task, compact, tokens } from "@/lib/types";
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
}: {
  task: Task;
  timeline: TranscriptItem[];
  children: ReactNode;
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
    <div className="space-y-5 p-5 text-sm">
      <section className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">任务目标</h3>
        <p className="break-words leading-relaxed">{task.title}</p>
        <div className="flex gap-3 text-xs text-muted-foreground">
          {!!plan.length && (
            <span>
              {plan.filter((row) => row.done).length}/{plan.length}
            </span>
          )}
          {task.usage.known && <span>{compact(tokens(task))} tokens</span>}
        </div>
      </section>
      <section className="border-t border-border/60 pt-3">{children}</section>
      {!!plan.length && (
        <section className="space-y-3 border-t border-border/60 pt-4">
          <h3 className="text-xs font-medium text-muted-foreground">进度</h3>
          <ul className="space-y-3">
            {plan.map((row, index) => (
              <li key={index} className="flex items-start gap-2">
                {row.done ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                ) : row.running ? (
                  <LoaderCircle className="mt-0.5 size-4 shrink-0 motion-safe:animate-spin" />
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
