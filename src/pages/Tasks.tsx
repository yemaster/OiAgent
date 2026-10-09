import {
  useOrganization,
  taskMarkKey,
  projectMarkKey,
} from "@/lib/organization";
import {
  TaskActions,
  WorkspaceItemActions,
  MarkIndicator,
} from "@/components/workspace/WorkspaceItemActions";
import {
  ArchiveSelection,
  ArchiveCheckbox,
  ArchiveToolbar,
} from "@/components/workspace/ArchiveSelection";
import { TaskContextMenu } from "@/components/workspace/TaskContextMenu";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Search,
  Plus,
  SlidersHorizontal,
  LayoutGrid,
  List,
  Folder,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Choice,
  StatusBadge,
  AgentIcon,
  Empty,
  PageHeading,
  SectionHeading,
} from "@/components/workspace/shared";
import {
  groupBy,
  agentNames,
  compact,
  filterTasks,
  topLevelTasks,
  isActive,
  projectName,
  relativeTime,
  tokens,
  type Task,
  type Snapshot,
} from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
export function TaskCard({
  task,
  onOpen,
}: {
  task: Task;
  onOpen: (t: Task) => void;
}) {
  const { marks } = useOrganization();
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
    >
      <TaskContextMenu task={task} onOpen={onOpen}>
        <Card className="group/item h-full gap-0 rounded-lg py-0 shadow-none transition-colors hover:bg-muted/50">
          <button
            aria-label={`打开会话：${task.title}`}
            onClick={() => onOpen(task)}
            className="w-full rounded-lg p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <AgentIcon kind={task.agentKind} className="size-4" />
                {agentNames[task.agentKind] || task.agentKind}
              </span>
              <StatusBadge
                status={task.status}
                terminal={task.source === "terminal"}
              />
            </div>
            <div className="mb-2 flex items-center gap-2">
              <MarkIndicator mark={marks[taskMarkKey(task)]} />
              <h3 className="line-clamp-1 text-sm font-medium">{task.title}</h3>
            </div>
            <p className="mb-4 line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground">
              {task.preview || "暂无消息"}
            </p>
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <Folder className="size-3.5 shrink-0" />
              <span className="truncate" title={task.project}>
                {projectName(task.project)}
              </span>
              <span className="ml-auto shrink-0 tabular-nums">
                {task.usage.known
                  ? `${compact(tokens(task))} tokens`
                  : "用量未上报"}
              </span>
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              {task.deviceName || "本机"} ·{" "}
              {task.deviceOnline === false ? "未连接 · " : ""}
              {relativeTime(task.updatedAt)}
            </div>
          </button>
          <div className="flex justify-end px-3 pb-2">
            <TaskActions task={task} />
          </div>
        </Card>
      </TaskContextMenu>
    </motion.div>
  );
}
export function TaskRows({
  tasks,
  onOpen,
}: {
  tasks: Task[];
  onOpen: (t: Task) => void;
}) {
  const { marks } = useOrganization();
  return (
    <div className="divide-y border-y bg-card">
      {tasks.map((t) => (
        <TaskContextMenu key={t.id} task={t} onOpen={onOpen}>
          <div className="group/item flex items-center gap-1 pr-3">
            <ArchiveCheckbox task={t} />
            <button
              aria-label={`打开会话：${t.title}`}
              onClick={() => onOpen(t)}
              className="flex min-w-0 flex-1 items-center gap-3 px-2 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-ring"
            >
              <AgentIcon kind={t.agentKind} className="hidden sm:inline-flex" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <MarkIndicator mark={marks[taskMarkKey(t)]} />
                  <span className="truncate text-sm font-medium">
                    {t.title}
                  </span>
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {t.deviceName || "本机"} ·{" "}
                  {t.deviceOnline === false ? "未连接 · " : ""}
                  {t.preview || agentNames[t.agentKind]}
                </div>
              </div>
              <span className="hidden w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground lg:block">
                {t.usage.known ? `${compact(tokens(t))} tokens` : "—"}
              </span>
              <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground xl:block">
                {relativeTime(t.updatedAt)}
              </span>
              <div className="ml-2">
                <StatusBadge status={t.status} />
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
            <TaskActions task={t} />
          </div>
        </TaskContextMenu>
      ))}
    </div>
  );
}
function Group({
  name,
  path,
  tasks,
  onOpen,
}: {
  name: string;
  path: string;
  tasks: Task[];
  onOpen: (t: Task) => void;
}) {
  const [open, setOpen] = useState(true);
  const { marks } = useOrganization();
  const projectKey = projectMarkKey(path, tasks[0]?.deviceId);
  return (
    <section>
      <div className="group/item mb-3 flex items-center gap-2">
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
        >
          <span>
            {open ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </span>
          {!marks[projectKey]?.pinned && (
            <Folder className="size-4 text-muted-foreground" />
          )}
          <MarkIndicator
            mark={marks[projectKey]}
            pinClassName="size-4 text-current"
          />
          <span className="truncate font-medium">{name}</span>
          <span className="text-xs text-muted-foreground">{tasks.length}</span>
          <span className="ml-2 hidden truncate text-xs text-muted-foreground xl:block">
            {path}
          </span>
        </button>
        <WorkspaceItemActions itemKey={projectKey} name={projectName(path)} />
      </div>
      {open && <TaskRows tasks={tasks} onOpen={onOpen} />}
    </section>
  );
}
export function TasksPage({
  snapshot,
  project,
  onOpen,
  onNew,
  history = false,
  onProject,
  onHistory,
  onDeleted,
  onRefresh,
}: {
  snapshot: Snapshot;
  project: string;
  onOpen: (t: Task) => void;
  onNew: () => void;
  history?: boolean;
  onProject: (p: string) => void;
  onHistory: () => void;
  onDeleted?: (ids: string[]) => Promise<void>;
  onRefresh?: () => Promise<void>;
}) {
  const { marks } = useOrganization();
  const pinned = (task: Task) => !!marks[taskMarkKey(task)]?.pinned;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [device, setDevice] = useState("all");
  const [agent, setAgent] = useState("all");
  const [status, setStatus] = useState("all");
  const [tab, setTab] = useState("all");
  const [view, setView] = useState("grid");
  const [limit, setLimit] = useState(30);
  const filtered = useMemo(
    () =>
      filterTasks(
        topLevelTasks(snapshot.tasks)
          .filter((t) => device === "all" || (t.deviceId || "local") === device)
          .filter((t) =>
            history
              ? !isActive(t) && (tab === "archived" ? t.archived : !t.archived)
              : !t.archived,
          ),
        query,
        project,
        agent,
        status,
      ),
    [snapshot.tasks, history, tab, query, project, agent, status, device],
  );
  const active = filtered
    .filter(isActive)
    .sort(
      (a, b) =>
        Number(pinned(b)) - Number(pinned(a)) ||
        Number(b.status === "waiting") - Number(a.status === "waiting"),
    );
  const recent = filtered
    .filter((t) => !isActive(t))
    .sort(
      (a, b) =>
        Number(pinned(b)) - Number(pinned(a)) ||
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  const shown = recent.slice(0, history ? limit : 5);
  const pinnedShown = shown.filter(pinned);
  const groups = groupBy(
    shown.filter((t) => !pinned(t)),
    (t) => `${t.deviceId || "local"}:${t.project}`,
  );
  const countTasks = filterTasks(
    topLevelTasks(snapshot.tasks).filter(
      (t) => device === "all" || (t.deviceId || "local") === device,
    ),
    query,
    project,
    agent,
  );
  const counts = {
    running: countTasks.filter((t) => !t.archived && t.status === "running")
      .length,
    waiting: countTasks.filter((t) => !t.archived && t.status === "waiting")
      .length,
    queued: countTasks.filter((t) => !t.archived && t.status === "queued")
      .length,
  };
  return (
    <ArchiveSelection
      enabled={history && tab === "archived"}
      scope={JSON.stringify([
        history,
        tab,
        query,
        project,
        agent,
        status,
        device,
      ])}
      tasks={recent}
      onDeleted={onDeleted}
      onRefresh={onRefresh}
    >
      <div className="mx-auto w-full max-w-7xl p-5 lg:p-8">
        <PageHeading
          title={
            history
              ? "历史记录"
              : project === "all"
                ? "当前任务"
                : projectName(project)
          }
        >
          <Button className="md:hidden" onClick={onNew}>
            <Plus />
            新建任务
          </Button>
        </PageHeading>
        {!history && (
          <div className="mb-5 overflow-x-auto border-b pb-1">
            <Tabs value={status} onValueChange={setStatus}>
              <TabsList variant="line" className="gap-4">
                <TabsTrigger value="all" className="text-xs">
                  全部
                  <span className="text-muted-foreground">
                    {counts.waiting + counts.running + counts.queued}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="waiting" className="text-xs">
                  等待操作
                  <span className="text-muted-foreground">
                    {counts.waiting}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="running" className="text-xs">
                  进行中
                  <span className="text-muted-foreground">
                    {counts.running}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="queued" className="text-xs">
                  待启动
                  <span className="text-muted-foreground">{counts.queued}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        )}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          {history && (
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="all">全部记录</TabsTrigger>
                <TabsTrigger value="archived">已归档</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <div className="relative min-w-44 flex-1 sm:max-w-sm">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              aria-label="搜索任务"
              placeholder={
                history ? "搜索历史对话、项目或内容…" : "搜索任务、项目或内容…"
              }
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(30);
              }}
              className="h-9 bg-card pl-9"
            />
          </div>
          <div className="md:hidden">
            <Choice
              label="筛选项目"
              value={project}
              onChange={onProject}
              options={[
                { value: "all", label: "全部项目" },
                ...snapshot.projects.map((p) => ({
                  value: p,
                  label: projectName(p),
                })),
              ]}
            />
          </div>
          {project !== "all" && (
            <Button
              variant="outline"
              size="sm"
              className="max-w-full shadow-none"
              aria-label={`取消项目筛选：${projectName(project)}`}
              title={project}
              onClick={() => onProject("all")}
            >
              <Folder className="size-3.5 shrink-0" />
              <span className="truncate">{projectName(project)}</span>
              <X className="size-3.5 shrink-0" />
            </Button>
          )}
          {!!snapshot.remoteDevices?.length && (
            <Choice
              label="筛选设备"
              value={device}
              onChange={setDevice}
              options={[
                { value: "all", label: "全部设备" },
                { value: "local", label: "本机" },
                ...snapshot.remoteDevices.map((d) => ({
                  value: d.id,
                  label: d.snapshot?.name || d.name,
                })),
              ]}
            />
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFiltersOpen(true)}
            className="shadow-none"
          >
            <SlidersHorizontal className="size-3.5" />
            筛选
            {agent !== "all" || (history && status !== "all")
              ? " · 已启用"
              : ""}
          </Button>
          {(agent !== "all" || (history && status !== "all")) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAgent("all");
                setStatus("all");
              }}
            >
              清除筛选
            </Button>
          )}
          <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>筛选{history ? "历史记录" : "任务"}</DialogTitle>
                <DialogDescription>
                  条件会同时应用于当前项目和搜索结果。
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <Choice
                  label="筛选 Agent"
                  value={agent}
                  onChange={setAgent}
                  options={[
                    { value: "all", label: "全部 Agent" },
                    ...snapshot.agents.map((a) => ({
                      value: a.id,
                      label: a.name,
                    })),
                    { value: "terminal", label: "终端" },
                    { value: "supervisor", label: "工作流" },
                  ]}
                />
                {history && (
                  <Choice
                    label="筛选状态"
                    value={status}
                    onChange={setStatus}
                    options={[
                      { value: "all", label: "全部状态" },
                      { value: "completed", label: "已完成" },
                      { value: "failed", label: "失败" },
                      { value: "cancelled", label: "已停止" },
                      { value: "interrupted", label: "已中断" },
                      { value: "imported", label: "历史会话" },
                    ]}
                  />
                )}
              </div>
              <Button onClick={() => setFiltersOpen(false)}>完成</Button>
            </DialogContent>
          </Dialog>
          {!history && (
            <div className="ml-auto flex rounded-md bg-muted p-0.5">
              <Button
                variant={view === "grid" ? "secondary" : "ghost"}
                size="icon-sm"
                aria-label="卡片视图"
                onClick={() => setView("grid")}
              >
                <LayoutGrid />
              </Button>
              <Button
                variant={view === "list" ? "secondary" : "ghost"}
                size="icon-sm"
                aria-label="列表视图"
                onClick={() => setView("list")}
              >
                <List />
              </Button>
            </div>
          )}
        </div>
        {!history && (
          <section className="mb-8">
            {active.length ? (
              view === "grid" ? (
                <div className="grid grid-cols-1 gap-3 min-[1050px]:grid-cols-2 min-[1550px]:grid-cols-3">
                  {active.map((t) => (
                    <TaskCard key={t.id} task={t} onOpen={onOpen} />
                  ))}
                </div>
              ) : (
                <TaskRows tasks={active} onOpen={onOpen} />
              )
            ) : (
              <Empty
                title={
                  query || status !== "all"
                    ? "没有符合条件的任务"
                    : "当前没有进行中的任务"
                }
                description="新建任务后，可以在这里查看最新进展。"
                action={
                  <Button variant="outline" onClick={onNew}>
                    <Plus />
                    新建任务
                  </Button>
                }
              />
            )}
          </section>
        )}
        {(history || (status === "all" && recent.length > 0)) && (
          <section>
            <SectionHeading
              count={history ? recent.length : undefined}
              action={
                history ? (
                  <span className="text-xs text-muted-foreground">
                    按项目分组
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onHistory}
                    className="text-xs text-muted-foreground"
                  >
                    全部历史
                    <ArrowRight className="size-3.5" />
                  </Button>
                )
              }
            >
              {history
                ? tab === "archived"
                  ? "已归档记录"
                  : "项目会话"
                : "最近记录"}
            </SectionHeading>
            <ArchiveToolbar />
            {pinnedShown.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-3 text-sm font-medium">置顶会话</h2>
                <TaskRows tasks={pinnedShown} onOpen={onOpen} />
              </section>
            )}
            <div className="space-y-6">
              {[...groups]
                .sort(
                  ([, a], [, b]) =>
                    Number(
                      !!marks[projectMarkKey(b[0].project, b[0].deviceId)]
                        ?.pinned,
                    ) -
                    Number(
                      !!marks[projectMarkKey(a[0].project, a[0].deviceId)]
                        ?.pinned,
                    ),
                )
                .map(([path, tasks]) => (
                  <Group
                    key={path}
                    name={`${projectName(tasks[0].project)} · ${tasks[0].deviceName || "本机"}`}
                    path={tasks[0].project}
                    tasks={tasks}
                    onOpen={onOpen}
                  />
                ))}
            </div>
            {!recent.length && (
              <Empty
                title="没有找到记录"
                description={
                  history
                    ? "导入本机历史，或尝试其他搜索条件。"
                    : "已结束的任务会按项目保存在这里。"
                }
              />
            )}{" "}
            {history && recent.length > limit && (
              <Button
                variant="ghost"
                className="mt-4 w-full"
                onClick={() => setLimit(limit + 30)}
              >
                加载更多（还剩 {recent.length - limit} 条）
              </Button>
            )}
          </section>
        )}
      </div>
    </ArchiveSelection>
  );
}
