import {
  ArchiveSelection,
  ArchiveCheckbox,
  ArchiveToolbar,
} from "@/components/workspace/ArchiveSelection";
import { useOrganization } from "@/lib/organization";
import { isActive } from "@/lib/types";
import { useState } from "react";
import {
  Plus,
  ArrowUpRight,
  Copy,
  Trash2,
  RefreshCw,
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  ChevronDown,
  CalendarClock,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
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
  PageHeading,
  StatusBadge,
  IconButton,
} from "@/components/workspace/shared";
import { call } from "@/lib/api";
import { newWorkflow, type WorkflowDefinition } from "@/lib/workflows";
import {
  projectName,
  relativeTime,
  type Snapshot,
  type Task,
} from "@/lib/types";
import type { useWorkflows } from "@/hooks/useWorkflows";
export function WorkflowsPage({
  state,
  snapshot,
  onEdit,
  onSchedule,
  onOpen,
  onDeleted,
  onRefresh,
  openProjects,
}: {
  state: ReturnType<typeof useWorkflows>;
  snapshot: Snapshot;
  onEdit: (d: WorkflowDefinition) => void;
  onSchedule?: (d: WorkflowDefinition) => void;
  onOpen: (t: Task) => void;
  onDeleted?: (ids: string[], projects: string[]) => Promise<void>;
  onRefresh?: () => Promise<void>;
  openProjects?: string[];
}) {
  const [archived, setArchived] = useState(false);
  const organization = useOrganization();
  const [remove, setRemove] = useState<WorkflowDefinition>();
  const [busy, setBusy] = useState(false);
  const search = state.query.trim().toLocaleLowerCase();
  const scope = `${archived}:${search}`;
  const [pageSize, setPageSize] = useState({ scope, count: 20 });
  const visibleCount = pageSize.scope === scope ? pageSize.count : 20;
  const [refreshing, setRefreshing] = useState(false);
  const definitions = state.definitions.filter(
    (d) =>
      state.archivedIds.includes(d.id) === archived &&
      `${d.name} ${d.goal}`.toLocaleLowerCase().includes(search),
  );
  const runs = snapshot.tasks
    .filter(
      (task) =>
        !task.deviceId &&
        task.source === "workflow" &&
        !!task.archived === archived &&
        `${task.title} ${task.project} ${task.preview}`
          .toLocaleLowerCase()
          .includes(search),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const activeRuns = runs.filter(isActive);
  const recentRuns = runs.filter((task) => !isActive(task));
  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([state.refresh(), onRefresh?.()]);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setRefreshing(false);
    }
  }
  function runList(tasks: Task[]) {
    return (
      <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 bg-card">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="group flex items-center gap-2 pr-2 transition-colors hover:bg-muted/40 focus-within:bg-muted/40"
          >
            <ArchiveCheckbox task={task} />
            <button
              className="min-w-0 flex-1 space-y-1.5 p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={() => onOpen(task)}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {task.title}
                </span>
                <StatusBadge status={task.status} />
              </div>
              {task.preview && (
                <p className="truncate text-xs text-muted-foreground">
                  {task.preview}
                </p>
              )}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1 truncate" title={task.project}>
                  {projectName(task.project)}
                </span>
                <time
                  className="shrink-0"
                  dateTime={task.updatedAt}
                  title={new Date(task.updatedAt).toLocaleString()}
                >
                  {relativeTime(task.updatedAt)}
                </time>
              </div>
            </button>
            {!isActive(task) && (
              <IconButton
                label={`${archived ? "恢复" : "归档"}运行：${task.title}`}
                disabled={organization.busy}
                onClick={() => void organization.archive(task, !archived)}
              >
                {archived ? <ArchiveRestore /> : <Archive />}
              </IconButton>
            )}
          </div>
        ))}
      </div>
    );
  }
  async function archiveDefinition(id: string) {
    setBusy(true);
    try {
      await call("archive_workflow", { id, archived: !archived });
      await state.refresh();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function deleteDefinition() {
    if (!remove) return;
    setBusy(true);
    try {
      await call("remove_workflow", {
        id: remove.id,
        revision: remove.revision,
      });
      await state.refresh();
      setRemove(undefined);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ArchiveSelection
      enabled={archived}
      scope={scope}
      tasks={runs}
      onDeleted={onDeleted}
      onRefresh={onRefresh}
      openProjects={openProjects}
    >
      <div className="@container mx-auto max-w-6xl space-y-6 p-5 sm:p-8">
        <PageHeading title="工作流">
          <Button onClick={() => onEdit(newWorkflow(snapshot.agents))}>
            <Plus />
            新建工作流
          </Button>
        </PageHeading>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="mr-auto min-w-40 flex-1 sm:max-w-80"
            aria-label="搜索工作流"
            placeholder="搜索工作流或运行记录…"
            value={state.query}
            onChange={(e) => state.setQuery(e.target.value)}
          />
          <Button
            variant={archived ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={archived}
            onClick={() => setArchived(!archived)}
          >
            <Archive />
            已归档
          </Button>
          <IconButton
            label="刷新工作流"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCw className={refreshing ? "animate-spin" : undefined} />
          </IconButton>
        </div>
        <div className="grid items-start gap-8 @3xl:grid-cols-[minmax(0,1fr)_17rem]">
          <section aria-label="运行记录" className="min-w-0 space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium">
                {archived ? "归档记录" : "运行记录"}
              </h2>
              <span className="text-xs tabular-nums text-muted-foreground">
                {runs.length}
              </span>
            </div>
            <ArchiveToolbar />
            {activeRuns.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground">
                  进行中 · {activeRuns.length}
                </h3>
                {runList(activeRuns)}
              </div>
            )}
            {recentRuns.length > 0 && (
              <div className="space-y-2">
                {activeRuns.length > 0 && (
                  <h3 className="text-xs font-medium text-muted-foreground">
                    最近运行
                  </h3>
                )}
                {runList(recentRuns.slice(0, visibleCount))}
                {recentRuns.length > visibleCount && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() =>
                      setPageSize({ scope, count: visibleCount + 20 })
                    }
                  >
                    加载更多
                  </Button>
                )}
              </div>
            )}
            {!runs.length && (
              <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                {search
                  ? "没有匹配的运行记录"
                  : archived
                    ? "暂无归档记录"
                    : "暂无运行记录"}
              </p>
            )}
          </section>
          <section aria-label="工作流列表" className="min-w-0 space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium">
                {archived ? "归档工作流" : "工作流列表"}
              </h2>
              <span className="text-xs tabular-nums text-muted-foreground">
                {definitions.length}
              </span>
            </div>
            {state.error && (
              <p role="alert" className="text-sm text-destructive">
                {state.error}
              </p>
            )}
            {!state.loaded && !state.error ? (
              <p className="py-6 text-sm text-muted-foreground">
                正在读取工作流…
              </p>
            ) : definitions.length ? (
              <div className="divide-y divide-border/60">
                {definitions.map((d) => (
                  <div
                    key={d.id}
                    className="group flex items-center gap-1 rounded-md py-1 transition-colors hover:bg-muted/40 focus-within:bg-muted/40"
                  >
                    <button
                      className="min-w-0 flex-1 rounded-md px-2 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => onEdit(d)}
                    >
                      <div className="truncate text-sm font-medium">
                        {d.name}
                      </div>
                      <div
                        className="mt-1 truncate text-xs text-muted-foreground"
                        title={d.goal}
                      >
                        {d.steps.length} 个节点{d.goal ? ` · ${d.goal}` : ""}
                      </div>
                    </button>
                    <IconButton
                      label={`${archived ? "恢复" : "归档"}工作流：${d.name}`}
                      disabled={busy}
                      onClick={() => void archiveDefinition(d.id)}
                    >
                      {archived ? <ArchiveRestore /> : <Archive />}
                    </IconButton>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`更多操作：${d.name}`}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {!archived && onSchedule && (
                          <DropdownMenuItem onSelect={() => onSchedule(d)}>
                            <CalendarClock />
                            定时执行
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onSelect={() =>
                            onEdit({
                              ...d,
                              id: "",
                              revision: 0,
                              name: `${d.name} 副本`,
                            })
                          }
                        >
                          <Copy />
                          复制工作流
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={busy}
                          onSelect={() => setRemove(d)}
                        >
                          <Trash2 />
                          删除工作流
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-6 text-sm text-muted-foreground">
                {search
                  ? "没有匹配的工作流"
                  : archived
                    ? "暂无归档工作流"
                    : "暂无工作流"}
              </p>
            )}
            {!archived && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-between"
                  >
                    从示例创建
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(["implement", "audit", "parallel", "branch"] as const).map(
                    (preset) => (
                      <DropdownMenuItem
                        key={preset}
                        onSelect={() =>
                          onEdit(newWorkflow(snapshot.agents, preset))
                        }
                      >
                        {preset === "implement"
                          ? "分析 → 确认 → 实现 → 检查"
                          : preset === "audit"
                            ? "审查 → 确认 → 修复 → 检查"
                            : preset === "parallel"
                              ? "并行审查 → 汇总"
                              : "检查 → 条件分支 → 汇总"}
                        <ArrowUpRight className="ml-auto" />
                      </DropdownMenuItem>
                    ),
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </section>
        </div>
        <Dialog
          open={!!remove}
          onOpenChange={(open) => {
            if (!open && !busy) setRemove(undefined);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>删除工作流？</DialogTitle>
              <DialogDescription>
                删除“{remove?.name}”。已有运行记录和子任务会保留。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setRemove(undefined)}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => void deleteDefinition()}
              >
                删除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ArchiveSelection>
  );
}
