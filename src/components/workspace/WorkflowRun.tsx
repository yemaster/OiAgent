import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Pause,
  Play,
  RotateCcw,
  Square,
  Copy,
  ChevronRight,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { call } from "@/lib/api";
import {
  stepNames,
  stepStatuses,
  type WorkflowDefinition,
  type WorkflowRun,
} from "@/lib/workflows";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";
export function WorkflowRunPanel({
  task,
  tasks,
  active,
  onOpen,
  onChanged,
  onCopy,
}: {
  task: Task;
  tasks: Task[];
  active: boolean;
  onOpen: (task: Task) => void;
  onChanged: () => Promise<void>;
  onCopy?: (definition: WorkflowDefinition) => void;
}) {
  const [run, setRun] = useState<WorkflowRun>();
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [selected, setSelected] = useState<number>();
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const value = await call<WorkflowRun>("workflow_run", { id: task.id });
        if (!disposed)
          setRun((old) =>
            !old || value.revision >= old.revision ? value : old,
          );
      } catch (error) {
        if (!disposed) setError(String(error));
      } finally {
        if (!disposed) timer = setTimeout(load, active ? 1200 : 10000);
      }
    }
    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [task.id, active]);
  async function control(action: string) {
    if (!run || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await call<WorkflowRun>("control_workflow", {
        id: task.id,
        revision: run.revision,
        action,
        feedback,
      });
      setRun((old) => (!old || value.revision >= old.revision ? value : old));
      setFeedback("");
      setSelected(undefined);
      await onChanged();
    } catch (error) {
      setError(String(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!run)
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {error || "正在读取工作流…"}
      </div>
    );
  const current = run.steps[run.cursor];
  const waiting = run.status === "waiting";
  const finished = run.status === "completed" || run.status === "cancelled";
  const shown = Math.min(selected ?? run.cursor, run.steps.length - 1);
  const childTasks = tasks.filter((t) => t.parentId === task.id);
  const usageKnown =
    run.llmUsage.known || childTasks.some((t) => t.usage.known);
  const tokens =
    run.llmUsage.input +
    run.llmUsage.output +
    childTasks.reduce((n, t) => n + t.usage.input + t.usage.output, 0);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-5 p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm">
            已完成 {run.steps.filter((s) => s.status === "completed").length} /{" "}
            {run.steps.length} 步
            <span className="ml-3 text-xs text-muted-foreground">
              {usageKnown
                ? `${tokens.toLocaleString()} Token（已上报）`
                : "Token 未上报"}
            </span>
          </p>
          {run.status === "running" && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy || run.pauseRequested}
              onClick={() => void control("pause")}
            >
              <Pause />
              {run.pauseRequested ? "等待当前步骤结束" : "暂停派发"}
            </Button>
          )}
          {!finished && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void control("cancel")}
            >
              <Square />
              停止
            </Button>
          )}
          {onCopy && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onCopy({ ...run.definition, id: "", revision: 0 })}
            >
              <Copy />
              复制为新工作流
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {waiting && (
          <section
            className="space-y-3 rounded-lg border bg-card p-4"
            aria-label="工作流待办"
          >
            <h2 className="text-sm font-medium">
              {run.error || "工作流已暂停"}
            </h2>
            {current?.status === "approval" && (
              <p className="whitespace-pre-wrap text-sm leading-6">
                {run.definition.steps[run.cursor].prompt}
              </p>
            )}
            <Label htmlFor={`workflow-feedback-${task.id}`}>
              补充说明（可选）
            </Label>
            <Textarea
              id={`workflow-feedback-${task.id}`}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="补充要求，或说明需要修改的问题"
            />
            <div className="flex flex-wrap gap-2">
              {current?.status === "approval" ? (
                <>
                  <Button
                    disabled={busy}
                    onClick={() => void control("approve")}
                  >
                    <Check />
                    确认并继续
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void control("cancel")}
                  >
                    拒绝并停止
                  </Button>
                </>
              ) : current?.status === "failed" ? (
                <>
                  <Button disabled={busy} onClick={() => void control("retry")}>
                    <RotateCcw />
                    {run.definition.steps[run.cursor].kind === "review"
                      ? "重新检查"
                      : "重试当前步骤"}
                  </Button>
                  {run.cursor > 0 &&
                    run.definition.steps[run.cursor].kind === "review" &&
                    run.definition.steps[run.cursor - 1].kind === "agent" && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => void control("repair")}
                      >
                        返工上一步
                      </Button>
                    )}
                </>
              ) : (
                <Button disabled={busy} onClick={() => void control("resume")}>
                  <Play />
                  继续执行
                </Button>
              )}
            </div>
            {current?.status === "failed" && (
              <p className="text-xs text-muted-foreground">
                重试会再次执行此步骤；已完成的其他步骤保留，已有文件修改不会撤销。
              </p>
            )}
          </section>
        )}
        <ol
          className="divide-y rounded-lg border bg-card"
          aria-label="工作流运行步骤"
        >
          {run.definition.steps.map((step, index) => {
            const state = run.steps[index];
            const expanded = shown === index;
            return (
              <li key={step.id}>
                <button
                  className="flex w-full items-center gap-3 p-4 text-left hover:bg-accent/50"
                  onClick={() => setSelected(expanded ? -1 : index)}
                  aria-expanded={expanded}
                >
                  <ChevronRight
                    className={cn(
                      "size-4 shrink-0 transition-transform",
                      expanded && "rotate-90",
                    )}
                  />
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {step.title}
                  </span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {stepNames[step.kind]}
                  </span>
                  <Badge
                    variant="secondary"
                    className={cn(
                      state.status === "failed" && "text-destructive",
                    )}
                  >
                    {stepStatuses[state.status]}
                  </Badge>
                </button>
                {expanded && (
                  <div className="space-y-4 border-t px-4 py-4 sm:px-10">
                    <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                      {step.prompt}
                    </p>
                    {!!state.taskIds.length && (
                      <div className="flex flex-wrap gap-2">
                        {state.taskIds.map((id, i) => {
                          const child = tasks.find((t) => t.id === id);
                          return (
                            <Button
                              key={id}
                              size="sm"
                              variant="outline"
                              disabled={!child}
                              onClick={() => child && onOpen(child)}
                            >
                              执行记录
                              {state.taskIds.length > 1 ? ` ${i + 1}` : ""}
                              <ArrowUpRight />
                            </Button>
                          );
                        })}
                      </div>
                    )}
                    {state.output && (
                      <div className="markdown break-words text-sm leading-7">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            img: ({ alt }) => (
                              <span>[图片：{alt || "附件"}]</span>
                            ),
                            a: ({ children }) => (
                              <span className="underline">{children}</span>
                            ),
                          }}
                        >
                          {state.output}
                        </ReactMarkdown>
                      </div>
                    )}
                    {(state.attempts > 0 || state.repairs > 0) && (
                      <p className="text-xs text-muted-foreground">
                        已执行 {state.attempts} 次
                        {state.repairs > 0 && ` · 自动返工 ${state.repairs} 次`}
                        {state.finishedAt &&
                          ` · ${new Date(state.finishedAt).toLocaleString()}`}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
