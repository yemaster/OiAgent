import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Pause,
  Play,
  RotateCcw,
  Square,
  Copy,
  MoreHorizontal,
  Maximize2,
  Minimize2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { WorkflowStatus } from "@/components/workflows/WorkflowStatus";
import { WorkflowGraph } from "@/components/workflows/LazyWorkflowGraph";
import { WorkflowArtifacts } from "./WorkflowArtifacts";
import { WorkflowReviewActions } from "./WorkflowReviewActions";
import { MarkdownCodeBlock } from "./CodeBlock";
import { SubagentCard } from "./Transcript";
import { Choice } from "./shared";
import { call } from "@/lib/api";
import {
  stepStatuses,
  type WorkflowDefinition,
  type WorkflowRun,
} from "@/lib/workflows";
import type { Agent, Task } from "@/lib/types";
import type { OpenProjectFile } from "@/lib/editFiles";

export function WorkflowRunPanel({
  task,
  tasks,
  agents,
  active,
  onOpen,
  onChanged,
  onCopy,
  onOpenFile,
}: {
  task: Task;
  tasks: Task[];
  agents?: Agent[];
  active: boolean;
  onOpen: (task: Task) => void;
  onChanged: () => Promise<void>;
  onCopy?: (definition: WorkflowDefinition) => void;
  onOpenFile?: OpenProjectFile;
}) {
  const [run, setRun] = useState<WorkflowRun>();
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [selected, setSelected] = useState<number>();
  const [panel, setPanel] = useState("step");
  const [wide, setWide] = useState(false);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const value = await call<WorkflowRun>("workflow_run", { id: task.id });
        if (!disposed)
          setRun((old) =>
            !old || value.id !== old.id || value.revision > old.revision
              ? value
              : old,
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
  const shown = run
    ? Math.max(0, Math.min(selected ?? run.cursor, run.steps.length - 1))
    : 0;
  function select(index: number) {
    setSelected(index);
    setFeedback("");
    setPanel("step");
  }
  async function control(action: string, sourceId?: string) {
    if (!run || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await call<WorkflowRun>(
        sourceId ? "rework_workflow" : "control_workflow",
        {
          id: task.id,
          revision: run.revision,
          ...(sourceId
            ? { sourceId, reviewId: run.definition.steps[shown]?.id }
            : { action }),
          feedback,
          stepId:
            run.definition.edges != null
              ? run.definition.steps[shown]?.id
              : undefined,
        },
      );
      setRun((old) => (!old || value.revision > old.revision ? value : old));
      setFeedback("");
      setSelected(undefined);
      setPanel("step");
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
  const current = run.steps[shown];
  const step = run.definition.steps[shown];
  const finished = ["completed", "cancelled"].includes(run.status);
  const actionable = run.steps.flatMap((step, i) =>
    ["approval", "failed"].includes(step.status) ? [i] : [],
  );
  const needsInput =
    !finished &&
    actionable.includes(shown) &&
    (run.definition.edges != null || shown === run.cursor);
  const child = tasks.find((task) => task.id === current.taskIds.at(-1));
  const waitingChildren = finished
    ? []
    : run.steps.flatMap((step, index) => {
        const child =
          step.status === "running" &&
          tasks.find(
            (task) =>
              task.id === step.taskIds.at(-1) && task.status === "waiting",
          );
        return child ? [{ child, index }] : [];
      });
  const childTasks = tasks.filter((t) => t.parentId === task.id);
  const tokens =
    run.llmUsage.input +
    run.llmUsage.output +
    childTasks.reduce((sum, t) => sum + t.usage.input + t.usage.output, 0);
  const usageKnown =
    run.llmUsage.known || childTasks.some((t) => t.usage.known);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
        <p className="mr-auto text-sm tabular-nums">
          {run.steps.filter((step) => step.status === "completed").length} /{" "}
          {run.steps.length} 已完成
        </p>
        {!finished && actionable.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => select(actionable[0])}
          >
            待处理 {actionable.length}
          </Button>
        )}
        {run.status === "running" && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy || run.pauseRequested}
            onClick={() => void control("pause")}
          >
            <Pause />
            {run.pauseRequested ? "正在暂停" : "暂停派发"}
          </Button>
        )}
        {run.status === "waiting" && !actionable.length && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void control("resume")}
          >
            <Play />
            继续执行
          </Button>
        )}
        {run.status === "cancelled" && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void control("resume")}
          >
            <Play />
            从断点继续
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="工作流操作">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() =>
                  onCopy({ ...run.definition, id: "", revision: 0 })
                }
              >
                <Copy />
                复制为新工作流
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {error && (
        <p role="alert" className="shrink-0 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:overflow-hidden",
          wide && panel === "artifacts"
            ? "lg:grid-cols-1"
            : "lg:grid-cols-[minmax(0,1fr)_minmax(360px,42%)]",
        )}
      >
        <div
          className={cn(
            "min-h-64 shrink-0 bg-muted/15 p-3 lg:min-h-0",
            wide && panel === "artifacts" && "hidden",
          )}
        >
          <WorkflowGraph
            className="h-64 min-h-64 lg:h-full lg:min-h-0"
            definition={run.definition}
            agents={agents}
            states={run.steps}
            tasks={tasks}
            selectedId={step.id}
            onSelect={(id) =>
              select(run.definition.steps.findIndex((step) => step.id === id))
            }
          />
        </div>
        <Tabs
          value={panel}
          onValueChange={setPanel}
          className="flex min-h-[440px] min-w-0 flex-1 flex-col gap-0 border-t bg-card lg:min-h-0 lg:border-t-0 lg:border-l"
        >
          <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
            <TabsList
              className="grid w-full grid-cols-2"
              aria-label="工作流详情"
            >
              <TabsTrigger value="step">步骤</TabsTrigger>
              <TabsTrigger value="artifacts">产物</TabsTrigger>
            </TabsList>
            {panel === "artifacts" && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={wide ? "收起产物面板" : "展开产物面板"}
                onClick={() => setWide((value) => !value)}
              >
                {wide ? <Minimize2 /> : <Maximize2 />}
              </Button>
            )}
          </div>
          <TabsContent
            value="artifacts"
            forceMount
            className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
          >
            <WorkflowArtifacts
              run={run}
              active={active && panel === "artifacts"}
              onOpenFile={onOpenFile}
            />
          </TabsContent>
          <TabsContent
            value="step"
            forceMount
            className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
          >
            <div className="shrink-0 space-y-3 border-b p-4">
              <Choice
                label="查看步骤"
                value={String(shown)}
                onChange={(value) => select(Number(value))}
                options={run.definition.steps.map((step, i) => ({
                  value: String(i),
                  label: `${i + 1}. ${step.title}`,
                }))}
              />
              <div className="flex items-center justify-between gap-2">
                <WorkflowStatus status={current.status} />
                <span className="text-xs text-muted-foreground">
                  {current.attempts > 0 ? `第 ${current.attempts} 次执行` : ""}
                </span>
              </div>
            </div>
            <div
              className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4"
              aria-label="步骤结果"
            >
              {waitingChildren.length > 0 && (
                <section aria-label="Agent 等待操作" className="space-y-2">
                  {waitingChildren.map(({ child, index }) => (
                    <div
                      key={child.id}
                      className="flex items-center gap-3 rounded-lg bg-muted/50 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {run.definition.steps[index].title}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {child.preview || "等待操作"}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onOpen(child)}
                      >
                        处理请求
                        <ArrowUpRight />
                      </Button>
                    </div>
                  ))}
                </section>
              )}
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  任务说明
                </summary>
                <p className="mt-2 whitespace-pre-wrap leading-6">
                  {step.prompt}
                </p>
              </details>
              {!!current.taskIds.length && (
                <div aria-label="节点执行记录" className="space-y-3">
                  {child && <SubagentCard task={child} onOpen={onOpen} />}
                  {current.taskIds.length > 1 && (
                    <details>
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        之前的执行（{current.taskIds.length - 1}）
                      </summary>
                      <div className="mt-2 space-y-2">
                        {current.taskIds
                          .slice(0, -1)
                          .toReversed()
                          .map((id) => {
                            const previous = tasks.find(
                              (task) => task.id === id,
                            );
                            return previous ? (
                              <SubagentCard
                                key={id}
                                task={previous}
                                onOpen={onOpen}
                              />
                            ) : null;
                          })}
                      </div>
                    </details>
                  )}
                </div>
              )}
              {current.output ? (
                <div className="markdown break-words text-sm leading-7">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      pre: MarkdownCodeBlock,
                      img: ({ alt }) => <span>[图片：{alt || "附件"}]</span>,
                      a: ({ children }) => (
                        <span className="underline">{children}</span>
                      ),
                    }}
                  >
                    {current.output}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {current.status === "pending"
                    ? "等待前序步骤"
                    : current.status === "running"
                      ? "正在执行…"
                      : current.status === "approval"
                        ? step.prompt
                        : stepStatuses[current.status]}
                </p>
              )}
              {run.error && !current.output && current.status === "failed" && (
                <p className="text-sm text-destructive">{run.error}</p>
              )}
            </div>
            {needsInput && (
              <section
                aria-label="工作流待办"
                className="max-h-[50%] shrink-0 space-y-3 overflow-y-auto border-t bg-card p-4"
              >
                <Textarea
                  aria-label="补充说明（可选）"
                  placeholder={
                    step.kind === "review" ? "补充修改要求…" : "补充说明…"
                  }
                  className="min-h-16 resize-y text-sm"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  {current.status === "approval" ? (
                    <>
                      <Button
                        disabled={busy}
                        onClick={() => void control("approve")}
                      >
                        <Check />
                        确认并继续
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void control("cancel")}
                      >
                        拒绝并停止
                      </Button>
                    </>
                  ) : step.kind === "review" ? (
                    <WorkflowReviewActions
                      key={step.id}
                      run={run}
                      index={shown}
                      tasks={tasks}
                      busy={busy}
                      onOpen={onOpen}
                      onRework={(sourceId) => void control("repair", sourceId)}
                      onRetry={() => void control("retry")}
                    />
                  ) : (
                    <>
                      {step.kind === "agent" && (
                        <Button
                          disabled={busy}
                          onClick={() => void control("continue")}
                        >
                          <Play />
                          继续当前步骤
                        </Button>
                      )}
                      <Button
                        variant={step.kind === "agent" ? "outline" : "default"}
                        disabled={busy}
                        onClick={() => void control("retry")}
                      >
                        <RotateCcw />
                        重新执行
                      </Button>
                    </>
                  )}
                </div>
              </section>
            )}
            {usageKnown && (
              <p className="shrink-0 border-t px-4 py-2 text-xs tabular-nums text-muted-foreground">
                累计 {tokens.toLocaleString()} Token
              </p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
