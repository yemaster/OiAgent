import { memo, useMemo, useState } from "react";
import { ChevronRight, LoaderCircle, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AgentIcon, Choice, StatusBadge } from "./shared";
import { ProgressSection } from "./ProgressCardLayout";
import { agentNames, compact, statusLabels, type Task } from "@/lib/types";
import {
  orderSubagents,
  subagentCounts,
  subagentName,
  subagentState,
  subagentStates,
} from "@/lib/subagents";
import { cn } from "@/lib/utils";
import { subagentDescription } from "@/lib/subagentDescription";

// Stable identity colours accompany the existing provider icons in both views.
const tones = [
  "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  "bg-amber-500/10 text-amber-700 dark:text-amber-300",
];
function SubagentAvatar({
  task,
  indicator = false,
}: {
  task: Task;
  indicator?: boolean;
}) {
  let hash = 0;
  for (const char of task.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const state = subagentState(task);
  return (
    <span className="relative inline-flex shrink-0">
      <AgentIcon
        kind={task.agentKind}
        className={cn(
          indicator ? "size-7 rounded-full" : "size-8 rounded-full",
          tones[hash % tones.length],
        )}
      />
      {indicator && (state === "running" || state === "stopping") && (
        <LoaderCircle
          aria-hidden="true"
          className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-card text-sky-600 motion-safe:animate-spin dark:text-sky-400"
        />
      )}
      {indicator &&
        (state === "failed" ||
          state === "waiting" ||
          state === "interrupted") && (
          <TriangleAlert
            aria-hidden="true"
            className={cn(
              "absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-card",
              state === "failed"
                ? "text-destructive"
                : "text-amber-600 dark:text-amber-400",
            )}
          />
        )}
    </span>
  );
}
function Counts({ tasks }: { tasks: Task[] }) {
  const counts = useMemo(() => subagentCounts(tasks), [tasks]);
  return (
    <span
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
      aria-label="子 Agent 状态汇总"
    >
      {counts.map(({ value, label, count, tone }) => (
        <span
          key={value}
          className={cn("whitespace-nowrap tabular-nums", tone)}
        >
          {count} {label}
        </span>
      ))}
    </span>
  );
}

/** Reference: the supplied Codex sidebar — a few identities and a short tally. */
export const SubagentSummary = memo(function SubagentSummary({
  tasks,
  onDetails,
  onOpen,
}: {
  tasks: Task[];
  onDetails: () => void;
  onOpen: (task: Task) => void;
}) {
  const preview = useMemo(() => orderSubagents(tasks).slice(0, 4), [tasks]);
  if (!tasks.length) return null;
  return (
    <ProgressSection aria-label="子 Agent 摘要" className="space-y-2.5">
      <button
        type="button"
        onClick={onDetails}
        aria-label={`查看全部子 Agent（${tasks.length}）`}
        className="group flex w-full items-center justify-between gap-2 rounded text-left text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        子 Agent <ChevronRight className="size-3.5" />
      </button>
      <div className="flex items-center gap-3">
        <div className="flex shrink-0 items-center gap-1">
          {preview.map((task) => (
            <Tooltip key={task.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-subagent-id={task.id}
                  onClick={() => onOpen(task)}
                  aria-label={`打开子 Agent：${subagentName(task)}`}
                  aria-description={
                    task.title !== subagentName(task) ? task.title : undefined
                  }
                  className="rounded-full transition-opacity hover:opacity-75 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <SubagentAvatar task={task} indicator />
                </button>
              </TooltipTrigger>
              <TooltipContent className="block">
                <span className="block">
                  {subagentName(task)} ·{" "}
                  {subagentState(task) === "offline"
                    ? "待同步"
                    : statusLabels[task.status]}
                </span>
                {task.title !== subagentName(task) && (
                  <span className="mt-1 block line-clamp-2 text-xs opacity-80">
                    {task.title}
                  </span>
                )}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        <button
          type="button"
          onClick={onDetails}
          aria-label={`查看子 Agent 详情，共 ${tasks.length} 个`}
          className="min-w-0 rounded text-left hover:opacity-75 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Counts tasks={tasks} />
        </button>
      </div>
    </ProgressSection>
  );
});

export const SubagentList = memo(function SubagentList({
  tasks,
  onOpen,
}: {
  tasks: Task[];
  onOpen: (task: Task) => void;
}) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState("all");
  const [limit, setLimit] = useState(40);
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return orderSubagents(tasks).filter(
      (task) =>
        (state === "all" || subagentState(task) === state) &&
        [
          subagentName(task),
          task.title,
          subagentDescription(task),
          task.model,
          agentNames[task.agentKind] || task.agentKind,
        ]
          .join("\n")
          .toLocaleLowerCase()
          .includes(needle),
    );
  }, [tasks, query, state]);
  if (!tasks.length)
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        暂无子 Agent
      </p>
    );
  return (
    <section aria-label="子 Agent 列表" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>共 {tasks.length} 个</span>
        <Counts tasks={tasks} />
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(40);
          }}
          aria-label="搜索子 Agent"
          placeholder="搜索子 Agent"
          className="h-8 min-w-0 flex-1"
        />
        <Choice
          label="子 Agent 状态"
          value={state}
          onChange={(value) => {
            setState(value);
            setLimit(40);
          }}
          className="h-8 w-28 shrink-0 text-xs"
          options={[
            { value: "all", label: "全部状态" },
            ...subagentStates.map(({ value, label }) => ({ value, label })),
          ]}
        />
      </div>
      {matches.length ? (
        <ul className="divide-y divide-border/60">
          {matches.slice(0, limit).map((task) => (
            <li key={task.id} data-subagent-id={task.id}>
              <button
                type="button"
                onClick={() => onOpen(task)}
                aria-label={`打开子 Agent：${subagentName(task)}`}
                aria-description={
                  task.title !== subagentName(task) ? task.title : undefined
                }
                className="flex w-full items-start gap-3 rounded-lg px-2 py-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <SubagentAvatar task={task} />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span
                      className="min-w-0 truncate text-sm font-medium"
                      title={subagentName(task)}
                    >
                      {subagentName(task)}
                    </span>
                    {subagentState(task) === "offline" ? (
                      <span className="text-xs text-muted-foreground">
                        待同步
                      </span>
                    ) : (
                      <StatusBadge status={task.status} />
                    )}
                  </div>
                  {task.title !== subagentName(task) && (
                    <p
                      className="line-clamp-1 break-words text-sm"
                      title={task.title}
                    >
                      {task.title}
                    </p>
                  )}
                  {subagentDescription(task) && (
                    <p className="line-clamp-2 break-words text-xs leading-5 text-muted-foreground">
                      {subagentDescription(task)}
                    </p>
                  )}
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>{agentNames[task.agentKind] || task.agentKind}</span>
                    {task.model && task.model !== "默认模型" && (
                      <span className="max-w-56 truncate" title={task.model}>
                        {task.model}
                      </span>
                    )}
                    {task.usage.known && (
                      <span className="tabular-nums">
                        {compact(task.usage.input + task.usage.output)} tokens
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="mt-1.5 size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">
          没有匹配的子 Agent
        </p>
      )}
      {matches.length > limit && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => setLimit((value) => value + 40)}
        >
          显示更多（还有 {matches.length - limit} 个）
        </Button>
      )}
    </section>
  );
});
