import { useRef, useState } from "react";
import {
  CalendarClock,
  Plus,
  Play,
  Pause,
  MoreHorizontal,
  Pencil,
  Trash2,
  RefreshCw,
  LoaderCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Choice,
  Empty,
  IconButton,
  PageHeading,
  StatusBadge,
} from "@/components/workspace/shared";
import { call, desktop } from "@/lib/api";
import { projectName, type Task } from "@/lib/types";
import {
  localTimezone,
  scheduleBusy,
  isScheduleRunActive,
  scheduleSummary,
  scheduleTime,
  type Schedule,
  type ScheduleDefinition,
  type ScheduleRun,
} from "@/lib/schedules";
import { openScheduledRun } from "@/lib/scheduleActions";
import type { useSchedules } from "@/hooks/useSchedules";
export function ScheduleRunStatus({ run }: { run: ScheduleRun }) {
  return run.status === "starting" ? (
    <Badge variant="secondary">
      <LoaderCircle className="size-3 animate-spin" />
      启动中
    </Badge>
  ) : run.status === "skipped" ? (
    <Badge variant="outline">已跳过</Badge>
  ) : (
    <StatusBadge status={run.status} />
  );
}
export function SchedulesPage({
  state,
  onEdit,
  onNew,
  onOpen,
}: {
  state: ReturnType<typeof useSchedules>;
  onEdit: (def: ScheduleDefinition) => void;
  onNew: () => void;
  onOpen: (task: Task) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [remove, setRemove] = useState<Schedule>();
  const [busy, setBusy] = useState("");
  const lock = useRef(false);
  const items = state.items.filter(
    (s) =>
      `${s.definition.name} ${s.definition.project}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()) &&
      (filter === "all" || s.definition.enabled === (filter === "enabled")),
  );
  async function action(item: Schedule, command: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(`${command}:${item.definition.id}`);
    try {
      const value = await call<Task | undefined>(command, {
        id: item.definition.id,
        revision: item.definition.revision,
        enabled: !item.definition.enabled,
      });
      if (command === "remove_schedule") setRemove(undefined);
      if (command === "run_schedule" && value) onOpen(value);
    } catch (error) {
      toast.error(String(error));
    } finally {
      await state.refresh().catch(() => {});
      lock.current = false;
      setBusy("");
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-5 sm:p-8">
      <PageHeading title="定时任务">
        <Button onClick={onNew}>
          <Plus />
          新建定时任务
        </Button>
      </PageHeading>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="搜索定时任务"
          placeholder="搜索名称或项目…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mr-auto min-w-40 flex-1 sm:max-w-80"
        />
        <Choice
          label="定时任务状态"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "全部" },
            { value: "enabled", label: "已启用" },
            { value: "paused", label: "已暂停 / 结束" },
          ]}
        />
        <IconButton
          label="刷新定时任务"
          onClick={() => void state.refresh().catch(() => {})}
        >
          <RefreshCw />
        </IconButton>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {!state.loaded && !state.error ? (
        <p role="status" className="text-sm text-muted-foreground">
          正在读取…
        </p>
      ) : !items.length ? (
        <Empty
          title={
            query || filter !== "all" ? "没有匹配的定时任务" : "暂无定时任务"
          }
          description={
            query || filter !== "all"
              ? ""
              : "选好项目、任务内容和时间，即可自动执行。"
          }
        />
      ) : (
        <div className="divide-y divide-border/60 rounded-lg border border-border/60 bg-card">
          {items.map((item) => {
            const def = item.definition,
              last = item.runs.find(isScheduleRunActive) || item.runs[0];
            const ended =
              def.rule.kind === "once" &&
              !def.enabled &&
              item.runs.some((r) => r.trigger === "schedule");
            return (
              <div
                key={def.id}
                className="flex flex-wrap items-center gap-3 p-4"
              >
                <button
                  onClick={() => onEdit(def)}
                  className="min-w-48 flex-1 space-y-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {def.name}
                    </span>
                    {!def.enabled && (
                      <Badge variant="secondary">
                        {ended ? "已结束" : "已暂停"}
                      </Badge>
                    )}
                  </div>
                  <div
                    className="truncate text-xs text-muted-foreground"
                    title={def.project}
                  >
                    {projectName(def.project)} · {scheduleSummary(def.rule)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {item.nextRunAt
                      ? `下次：${scheduleTime(item.nextRunAt, "timezone" in def.rule ? def.rule.timezone : undefined)}${"timezone" in def.rule && def.rule.timezone !== localTimezone() ? ` · ${def.rule.timezone}` : ""}`
                      : "—"}
                  </div>
                </button>
                {last && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-2"
                    disabled={last.status === "starting"}
                    onClick={() =>
                      last.taskId
                        ? void openScheduledRun(last, onOpen)
                        : onEdit(def)
                    }
                    title={last.message || "查看最近运行"}
                  >
                    <span className="text-xs text-muted-foreground">
                      {isScheduleRunActive(last) ? "当前" : "最近"}
                    </span>
                    <ScheduleRunStatus run={last} />
                  </Button>
                )}
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    label={`立即运行：${def.name}`}
                    disabled={!desktop || !!busy || scheduleBusy(item)}
                    onClick={() => void action(item, "run_schedule")}
                  >
                    {busy === `run_schedule:${def.id}` ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Play />
                    )}
                  </IconButton>
                  {!ended && (
                    <IconButton
                      label={`${def.enabled ? "暂停" : "启用"}：${def.name}`}
                      disabled={!desktop || !!busy}
                      onClick={() => void action(item, "set_schedule_enabled")}
                    >
                      {def.enabled ? <Pause /> : <CalendarClock />}
                    </IconButton>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`更多操作：${def.name}`}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onEdit(def)}>
                        <Pencil />
                        编辑
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={!!busy}
                        onSelect={() => setRemove(item)}
                      >
                        <Trash2 />
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        在本机执行，需保持电脑唤醒、OiAgent 运行。可最小化到托盘。
      </p>
      <Dialog
        open={!!remove}
        onOpenChange={(open) => {
          if (!open && !busy) setRemove(undefined);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除定时任务？</DialogTitle>
            <DialogDescription>保留已创建的任务和项目文件。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() => setRemove(undefined)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={!!busy || !desktop}
              onClick={() => remove && void action(remove, "remove_schedule")}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
