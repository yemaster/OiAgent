import { ProgressCardLayout, ProgressSection } from "./ProgressCardLayout";
import { useMemo } from "react";
import {
  ChevronRight,
  File,
  FileDiff,
  Globe,
  ListTodo,
  LoaderCircle,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { useTaskArtifacts, Artifact } from "@/hooks/useTaskArtifacts";
import type { ActivityKind } from "@/hooks/useActivityNotices";
import type { TranscriptItem } from "@/lib/transcript";
import type { StepChange } from "@/lib/stepChanges";
import type { OpenProjectFile } from "@/lib/editFiles";
import type { SessionCommand, SessionService } from "@/lib/sessionActivity";
import { statusLabels, type Task } from "@/lib/types";
import { latestTaskPlan } from "@/lib/taskPlan";
import { cn } from "@/lib/utils";
import { TaskOverview } from "./TaskOverview";
import { TaskGitOverview } from "./TaskGitOverview";
import { IconButton } from "./shared";
import { changeLineTotals } from "@/lib/changeLineStats";
import { LineChangeCount } from "./LineChangeCount";

// Supplied references: Qoder task monitor, ZCode Git/Goal/Progress,
// ChatGPT Outputs. Keep actual short lists and a separate route to details.
export function TaskContextCard({
  task,
  timeline,
  changes,
  truncated,
  artifacts,
  processes,
  services,
  unread,
  onClose,
  onOpen,
  onChange,
  onGit,
  onFile,
  onPlan,
  onPorts,
}: {
  task: Task;
  timeline: TranscriptItem[];
  changes: StepChange[];
  truncated?: boolean;
  artifacts?: ReturnType<typeof useTaskArtifacts>;
  processes: SessionCommand[];
  services: SessionService[];
  unread: Record<ActivityKind, number>;
  onClose: () => void;
  onOpen: (kind: ActivityKind) => void;
  onChange: (path?: string) => void;
  onGit?: () => void;
  onFile?: OpenProjectFile;
  onPlan: (key: string) => void;
  onPorts?: () => void;
}) {
  const files = useMemo(() => {
    const grouped = new Map<
      string,
      { file: StepChange; parts: StepChange[] }
    >();
    for (const change of changes) {
      const previous = grouped.get(change.path);
      const parts = previous?.file.step === change.step ? previous.parts : [];
      parts.push(change);
      grouped.set(change.path, { file: change, parts });
    }
    return [...grouped.values()];
  }, [changes]);
  const outputs = artifacts?.data?.files || [];
  function heading(
    kind: ActivityKind,
    label: string,
    count: number,
    onClick = () => onOpen(kind),
  ) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2 rounded text-left text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={`${label} ${count}${unread[kind] ? `，${unread[kind]} 条未读` : ""}`}
      >
        <span className="flex-1">{label}</span>
        <span className="text-xs tabular-nums">{count}</span>
        {unread[kind] > 0 && (
          <span
            className="size-1.5 rounded-full bg-sky-500"
            aria-label="有新增内容"
          />
        )}
        <ChevronRight className="size-3.5" />
      </button>
    );
  }
  function details(label: string, onClick: () => void) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        {label}
        <ChevronRight className="size-3" />
      </button>
    );
  }
  function openFile(file: Artifact) {
    if (onFile && !file.error)
      onFile(file.project, file.relativePath || file.path);
    else onOpen("artifacts");
  }
  return (
    <ProgressCardLayout className="overflow-hidden rounded-2xl border border-border/70 bg-muted/50 px-4 text-sm shadow-sm dark:bg-muted/70">
      <header className="flex items-center gap-2 pt-3 pb-1">
        <ListTodo className="size-4 text-muted-foreground" />
        <span className="flex-1 font-medium">任务进展</span>
        <span
          className={cn("rounded-md px-2 py-1 text-xs", {
            "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400":
              task.status === "completed",
            "bg-sky-500/10 text-sky-700 dark:text-sky-400":
              task.status === "running",
            "bg-amber-500/10 text-amber-700 dark:text-amber-400": [
              "waiting",
              "queued",
              "stopping",
            ].includes(task.status),
            "bg-red-500/10 text-red-700 dark:text-red-400":
              task.status === "failed",
            "bg-background/40 text-muted-foreground": [
              "cancelled",
              "interrupted",
              "imported",
            ].includes(task.status),
          })}
        >
          {statusLabels[task.status]}
        </span>
        <IconButton label="关闭任务进展" size="icon-xs" onClick={onClose}>
          <X />
        </IconButton>
      </header>
      <div className="divide-y divide-border/60 [&>section]:py-4">
        {onGit && (
          <TaskGitOverview
            project={task.project}
            taskId={task.id}
            status={task.status}
            revision={changes.length}
            onOpenFile={onFile}
            onDetails={onGit}
          />
        )}
        {(files.length > 0 || truncated) && (
          <ProgressSection aria-label="会话改动摘要" className="space-y-2.5">
            {heading("changes", "本次改动", files.length, () => onChange())}
            <ul className="space-y-0.5">
              {files
                .toReversed()
                .slice(0, 3)
                .map(({ file, parts }) => (
                  <li key={file.path}>
                    <Button
                      variant="ghost"
                      className="h-8 w-full justify-start gap-2.5 px-0 text-xs font-normal"
                      title={file.path}
                      onClick={() => onChange(file.path)}
                    >
                      <FileDiff className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-left">
                        {file.relativePath || file.path}
                      </span>
                      {file.state === "failed" ? (
                        <span className="shrink-0 text-[11px] text-red-700 dark:text-red-400">
                          失败
                        </span>
                      ) : ["called", "running"].includes(file.state) ? (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          执行中
                        </span>
                      ) : (
                        <LineChangeCount
                          stats={changeLineTotals(parts)}
                          title="最近一次改动的增删行数"
                        />
                      )}
                    </Button>
                  </li>
                ))}
            </ul>
            {details("查看会话改动", () => onChange())}
          </ProgressSection>
        )}
        <ProgressSection className="space-y-2">
          <h3 className="text-muted-foreground">目标</h3>
          <p className="line-clamp-2 leading-6" title={task.title}>
            {task.title}
          </p>
        </ProgressSection>
        {latestTaskPlan(timeline).rows.length > 0 && (
          <ProgressSection>
            <TaskOverview timeline={timeline} hideEmpty onNavigate={onPlan} />
          </ProgressSection>
        )}
        {processes.length > 0 && (
          <ProgressSection aria-label="运行摘要" className="space-y-2.5">
            {heading("processes", "进程", processes.length)}
            <ul className="space-y-0.5">
              {processes
                .toReversed()
                .slice(0, 3)
                .map((command) => (
                  <li key={command.id}>
                    <Button
                      variant="ghost"
                      className="h-8 w-full justify-start gap-2.5 px-0 text-xs font-normal"
                      title={command.command}
                      onClick={() => onOpen("processes")}
                    >
                      <LoaderCircle
                        aria-hidden="true"
                        className={cn(
                          "size-3.5 shrink-0 motion-safe:animate-spin",
                          command.state === "pending"
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-sky-600 dark:text-sky-400",
                        )}
                      />
                      <code className="min-w-0 flex-1 truncate text-left">
                        {command.command}
                      </code>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {command.state === "pending"
                          ? "等待结果"
                          : command.background
                            ? "后台运行"
                            : "运行中"}
                      </span>
                    </Button>
                  </li>
                ))}
            </ul>
            {details("查看进程详情", () => onOpen("processes"))}
          </ProgressSection>
        )}
        {services.length > 0 && (
          <ProgressSection aria-label="端口摘要" className="space-y-2.5">
            {heading("processes", "端口", services.length, onPorts)}
            <ul className="space-y-0.5">
              {services.slice(0, 3).map((service) => (
                <li key={service.id}>
                  <Button
                    variant="ghost"
                    className="h-8 w-full justify-start gap-2.5 px-0 text-sm font-normal"
                    onClick={onPorts || (() => onOpen("processes"))}
                  >
                    <Globe className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-left">
                      {service.host}:{service.port}
                    </span>
                    {service.reachable && (
                      <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        可连接
                      </span>
                    )}
                  </Button>
                </li>
              ))}
            </ul>
            {details("查看端口详情", onPorts || (() => onOpen("processes")))}
          </ProgressSection>
        )}
        {(outputs.length > 0 || artifacts?.error) && (
          <ProgressSection aria-label="任务文件摘要" className="space-y-2.5">
            {heading("artifacts", "输出内容", outputs.length)}
            <ul className="space-y-0.5">
              {outputs.slice(0, 3).map((file) => (
                <li key={file.path}>
                  <Button
                    variant="ghost"
                    className="h-8 w-full justify-start gap-2.5 px-0 text-sm font-normal"
                    title={file.relativePath || file.path}
                    onClick={() => openFile(file)}
                  >
                    <File className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">
                      {file.relativePath || file.path}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
            {artifacts?.error && (
              <p role="alert" className="break-words text-xs text-destructive">
                {artifacts.error}
              </p>
            )}
            {details("查看全部文件", () => onOpen("artifacts"))}
          </ProgressSection>
        )}
      </div>
    </ProgressCardLayout>
  );
}
