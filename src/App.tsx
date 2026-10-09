import { usePageTransition } from "@/hooks/usePageTransition";
import { useNavigationHistory } from "@/hooks/useNavigationHistory";
import { newTaskDraft } from "@/lib/newTask";
import type { LlmDraft } from "@/components/workspace/LlmSettings";
import { isSettingsPage } from "@/lib/navigation";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { PaneBoundary } from "@/components/workspace/PaneBoundary";
import { useFiles } from "@/hooks/useFiles";
import {
  useTabHistory,
  type TabLocation,
  type WorkspaceLocation,
} from "@/hooks/useTabHistory";
import { useRecentProjects } from "@/hooks/useRecentProjects";
import { ProviderManager } from "@/components/workspace/ProviderManager";
import { TaskTabs } from "@/components/workspace/TaskTabs";
import type { TaskDraft } from "@/lib/permissions";
import { AppearanceProvider } from "@/components/AppearanceProvider";
import { listen } from "@tauri-apps/api/event";
import { MotionConfig } from "motion/react";
import {
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Command,
  ArrowUpRight,
  AlertCircle,
  Menu,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { IconButton, StatusBadge } from "@/components/workspace/shared";
import { TasksPage } from "@/pages/Tasks";
import { NewTaskPage } from "@/pages/NewTask";
import { useRemoteDevices } from "@/hooks/useRemoteDevices";
import { LanSettingsPage } from "@/pages/LanSettings";
import { IntegrationsPage } from "@/pages/Integrations";
import { AgentsPage } from "@/pages/Agents";
import { SettingsPage } from "@/pages/Settings";
import { call, desktop, pickDirectory } from "@/lib/api";
import {
  projectName,
  filterTasks,
  isActive,
  type Snapshot,
  type Task,
  type Page,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { WorkspaceNavigation } from "@/components/workspace/Navigation";
import { pageNames, sectionFor, sections } from "@/lib/navigation";
import { GuidePage } from "@/pages/Guide";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
const FileEditor = lazy(() =>
  import("@/pages/FileEditor").then((m) => ({ default: m.FileEditor })),
);
const DetailPage = lazy(() =>
  import("@/pages/Detail").then((m) => ({ default: m.DetailPage })),
);
const StatsPage = lazy(() =>
  import("@/pages/Stats").then((m) => ({ default: m.StatsPage })),
);
const empty: Snapshot = {
  agents: [],
  tasks: [],
  projects: [],
  warnings: [],
  dataDir: "",
};
function Loading() {
  return (
    <div className="space-y-6 p-8">
      <Skeleton className="h-8 w-40" />
      <div className="grid grid-cols-2 gap-5">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
export default function App() {
  return (
    <AppearanceProvider>
      <WorkspaceApp />
    </AppearanceProvider>
  );
}
function WorkspaceApp() {
  const fileWorkspace = useFiles();
  const activeFile = fileWorkspace.active;
  const [localSnapshot, setSnapshot] = useState<Snapshot>(empty);
  const remote = useRemoteDevices();
  const snapshot: Snapshot = {
    ...localSnapshot,
    tasks: [...localSnapshot.tasks, ...remote.tasks],
    remoteDevices: remote.devices,
  };
  const [page, setPage] = useState<Page>(() =>
    localStorage.getItem("oiagent-onboarded") === "true" ? "tasks" : "guide",
  );
  useEffect(() => {
    // Opening the app counts as seeing onboarding; completing the guide is optional.
    localStorage.setItem("oiagent-onboarded", "true");
  }, []);
  const [project, setProject] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [detailTrail, setDetailTrail] = useState<string[]>([]);
  const [seed, setSeed] = useState<Task>();
  const [opened, setOpened] = useState<string[]>([]);
  const [integrationKind, setIntegrationKind] = useState<string>();
  const [draft, setDraft] = useState<TaskDraft>();
  const [newTaskKey, setNewTaskKey] = useState(0);
  const [llmDraft, setLlmDraft] = useState<LlmDraft>(() => ({
    url: localStorage.getItem("oiagent-api-url") || "",
    model: localStorage.getItem("oiagent-api-model") || "",
    key: "",
  }));
  const [returnToDraft, setReturnToDraft] = useState<Page | null>(null);
  const [sidebar, setSidebar] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [autoRefresh, setAuto] = useState(
    localStorage.getItem("oiagent-refresh") !== "false",
  );
  const refreshingRef = useRef(false);
  const refresh = useCallback(async (scan = false, cached = false) => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      setSnapshot(await call<Snapshot>("get_snapshot", { scan, cached }));
      setError("");
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    // Show saved state first; discovery and history indexing do not block the workspace.
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh(false, true)
      .then(() => refresh(true))
      .catch(() => {});
  }, [refresh]);
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => void refresh().catch(() => {}), 15000);
    return () => clearInterval(t);
  }, [autoRefresh, refresh]);
  useEffect(() => {
    if (!desktop) return;
    let dispose: (() => void) | undefined;
    let closed = false;
    void listen<Task>("task-changed", ({ payload: t }) => {
      setSnapshot((s) => ({
        ...s,
        tasks: [t, ...s.tasks.filter((x) => x.id !== t.id)],
      }));
    }).then((fn) => {
      if (closed) fn();
      else dispose = fn;
    });
    return () => {
      closed = true;
      dispose?.();
    };
  }, []);
  const {
    selected: selectedFileId,
    select: selectFile,
    save: saveFile,
    close: requestFileClose,
    discard: discardFileBuffer,
  } = fileWorkspace;
  const task = snapshot.tasks.find((t) => t.id === selected);
  const pageTransition = usePageTransition(
    activeFile
      ? `file:${activeFile.id}`
      : task
        ? `task:${task.id}`
        : `${page}:${project}:${newTaskKey}`,
  );
  const afterClose = useTabHistory(
    activeFile
      ? { kind: "file", id: activeFile.id, taskId: task?.id }
      : task
        ? { kind: "task", id: task.id }
        : { kind: "page", page, project },
    [
      ...opened
        .filter((id) => snapshot.tasks.some((t) => t.id === id))
        .map((id) => `task:${id}`),
      ...fileWorkspace.files.map((f) => `file:${f.id}`),
    ],
  );
  const activateLocation = useCallback(
    (next: WorkspaceLocation, closed?: TabLocation) => {
      setDetailTrail([]);
      if (next.kind === "file") {
        selectFile(next.id);
        setSelected(
          next.taskId &&
            opened.includes(next.taskId) &&
            next.taskId !== (closed?.kind === "task" ? closed.id : null)
            ? next.taskId
            : null,
        );
      } else if (next.kind === "task") {
        selectFile(null);
        setSelected(next.id);
      } else {
        selectFile(null);
        setSelected(null);
        setPage(next.page);
        setProject(next.project);
      }
      requestAnimationFrame(() => {
        const target =
          next.kind === "page"
            ? document.querySelector<HTMLElement>("main")
            : document.getElementById(`${next.kind}-tab-${next.id}`);
        target?.focus({ preventScroll: true });
        if (next.kind !== "page")
          target?.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    },
    [opened, selectFile, setDetailTrail, setSelected, setPage, setProject],
  );
  const navigationHistory = useNavigationHistory(
    {
      location: activeFile
        ? { kind: "file", id: activeFile.id, taskId: task?.id }
        : task
          ? { kind: "task", id: task.id }
          : { kind: "page", page, project },
      draft,
      seed,
      newTaskKey,
      returnToDraft,
      integrationKind,
    },
    ({ location }) =>
      location.kind === "task"
        ? opened.includes(location.id) &&
          snapshot.tasks.some((t) => t.id === location.id)
        : location.kind === "file"
          ? fileWorkspace.files.some((f) => f.id === location.id)
          : true,
  );
  function goBack() {
    if (fileWorkspace.closing) return;
    const next = navigationHistory.back();
    if (!next) return;
    if (next.location.kind === "page") {
      setDraft(next.draft);
      setSeed(next.seed);
      setNewTaskKey(next.newTaskKey);
      setReturnToDraft(next.returnToDraft);
      setIntegrationKind(next.integrationKind);
    }
    setSearchOpen(false);
    activateLocation(next.location);
  }
  const restoreAfterClose = useCallback(
    (closed: TabLocation) => {
      const next = afterClose(closed);
      if (next) activateLocation(next, closed);
    },
    [afterClose, activateLocation],
  );
  const closeTab = useCallback(
    (id: string) => {
      setOpened((ids) => ids.filter((t) => t !== id));
      setDetailTrail((trail) => trail.filter((t) => t !== id));
      // A task can remain selected underneath a visible file; closing it must not switch views.
      if (selected === id) setSelected(null);
      restoreAfterClose({ kind: "task", id });
    },
    [selected, restoreAfterClose, setDetailTrail, setSelected, setOpened],
  );
  const closeFile = useCallback(
    (id: string) => {
      if (requestFileClose(id)) restoreAfterClose({ kind: "file", id });
    },
    [requestFileClose, restoreAfterClose],
  );
  const discardFile = useCallback(
    (id: string) => {
      discardFileBuffer(id);
      restoreAfterClose({ kind: "file", id });
    },
    [discardFileBuffer, restoreAfterClose],
  );
  const closingBatch = useRef(false);
  async function closeMany(tabs: TabLocation[]) {
    if (closingBatch.current || fileWorkspace.closing) return;
    closingBatch.current = true;
    const isCurrent = (tab: TabLocation) =>
      activeFile
        ? tab.kind === "file" && tab.id === activeFile.id
        : tab.kind === "task" && tab.id === selected;
    const ordered = [...tabs].sort(
      (a, b) => Number(isCurrent(a)) - Number(isCurrent(b)),
    );
    try {
      for (const tab of ordered) {
        if (tab.kind === "task") closeTab(tab.id);
        else {
          if (!(await fileWorkspace.closeAndWait(tab.id))) break;
          restoreAfterClose(tab);
        }
      }
    } finally {
      closingBatch.current = false;
    }
  }
  function beginNewTask(explicitProject?: string, explicitTask?: Task) {
    const contextTask =
      explicitTask || (!explicitProject && !activeFile ? task : undefined);
    const directory =
      explicitProject || activeFile?.project || contextTask?.project || project;
    setDraft(
      newTaskDraft(
        { ...localSnapshot, remoteDevices: remote.devices },
        directory,
        contextTask,
      ),
    );
    setProject(contextTask?.deviceId ? "all" : directory);
    selectFile(null);
    setSelected(null);
    setDetailTrail([]);
    setSeed(undefined);
    setReturnToDraft(null);
    setNewTaskKey((value) => value + 1);
    setPage("new");
  }
  const newTaskFromKeyboard = useEffectEvent(() => beginNewTask());
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (fileWorkspace.closing) return;
      if (
        e.target instanceof Element &&
        e.target.closest("[data-terminal-surface]")
      )
        return;
      if ((e.metaKey || e.ctrlKey) && e.key === "s" && selectedFileId) {
        e.preventDefault();
        void saveFile(selectedFileId);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "w" && selectedFileId) {
        e.preventDefault();
        closeFile(selectedFileId);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "w" && selected) {
        e.preventDefault();
        closeTab(selected);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        newTaskFromKeyboard();
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [
    selected,
    closeTab,
    selectedFileId,
    selectFile,
    saveFile,
    closeFile,
    fileWorkspace.closing,
  ]);
  const active = snapshot.tasks.filter((t) => isActive(t) && !t.archived);
  function navigate(p: Page) {
    if (p === "new") {
      beginNewTask();
      return;
    }
    fileWorkspace.select(null);
    if (
      returnToDraft &&
      (["agents", "claude-api", "integrations"].includes(p) ||
        isSettingsPage(p))
    ) {
      setPage(p);
      setSelected(null);
      return;
    }
    setReturnToDraft(null);
    setDetailTrail([]);
    setPage(p);
    setSelected(null);
    setSeed(undefined);
  }
  function open(t: Task) {
    fileWorkspace.select(null);
    setOpened((ids) => (ids.includes(t.id) ? ids : [...ids, t.id]));
    if (selected && selected !== t.id)
      setDetailTrail((trail) => {
        const index = trail.lastIndexOf(t.id);
        return index >= 0 ? trail.slice(0, index) : [...trail, selected];
      });
    setSelected(t.id);
    setSearchOpen(false);
  }
  function leaveDraft(destination: Page, value: TaskDraft) {
    setDraft(value);
    setReturnToDraft(page);
    setPage(destination);
  }
  async function addProject() {
    try {
      const dir = await pickDirectory();
      if (dir) {
        const p = await call<string>("add_project", { project: dir });
        await refresh();
        setProject(p);
        navigate("tasks");
      }
    } catch (e) {
      toast.error(String(e));
    }
  }
  function created(t: Task) {
    fileWorkspace.select(null);
    setDraft(undefined);
    setReturnToDraft(null);
    setOpened((ids) => (ids.includes(t.id) ? ids : [...ids, t.id]));
    setDetailTrail([]);
    if (t.deviceId) remote.upsert(t);
    else
      setSnapshot((s) => ({
        ...s,
        tasks: [t, ...s.tasks.filter((x) => x.id !== t.id)],
        projects: s.projects.includes(t.project)
          ? s.projects
          : [...s.projects, t.project],
      }));
    setSelected(t.id);
    setPage("tasks");
    void refresh().catch(() => {});
  }
  function retry(t: Task) {
    fileWorkspace.select(null);
    setDraft(undefined);
    setReturnToDraft(null);
    setDetailTrail([]);
    setSeed(t);
    setSelected(null);
    setPage(t.source === "supervisor" ? "supervisor" : "new");
  }
  // An open task owns its breadcrumb and sidebar, independent of the page beneath it.
  const visiblePage: Page = activeFile
    ? "tasks"
    : task
      ? task.source === "history"
        ? "history"
        : "tasks"
      : page;
  const visibleProject = activeFile?.project || task?.project || project;
  const workspaceReturn = useRef<WorkspaceLocation>({
    kind: "page",
    page: "tasks",
    project: "all",
  });
  useLayoutEffect(() => {
    if (sectionFor(visiblePage) === "workspace") {
      workspaceReturn.current = activeFile
        ? { kind: "file", id: activeFile.id, taskId: task?.id }
        : task
          ? { kind: "task", id: task.id }
          : { kind: "page", page, project };
    }
  }, [visiblePage, activeFile, task, page, project]);
  const recentProjects = useRecentProjects(
    snapshot.projects,
    localSnapshot.tasks,
    sectionFor(visiblePage) === "workspace" && !task?.deviceId
      ? visibleProject
      : "all",
    activeFile?.id || task?.id || visibleProject,
  );
  const title = pageNames[visiblePage];
  const closingFile = fileWorkspace.files.find(
    (file) => file.id === fileWorkspace.closing,
  );
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <div
          className="flex h-dvh min-h-0 flex-col"
          onContextMenu={(event) => {
            const target = event.target;
            // Preserve native text editing, Monaco commands and TUI mouse reporting.
            if (
              target instanceof Element &&
              target.closest(
                "input, textarea, [contenteditable=true], .monaco-editor, [data-terminal-surface]",
              )
            )
              return;
            if (!window.getSelection()?.toString()) event.preventDefault();
          }}
        >
          <div className="flex min-h-0 flex-1">
            <WorkspaceNavigation
              page={visiblePage}
              project={visibleProject}
              snapshot={{ ...snapshot, projects: recentProjects }}
              sidebar={sidebar}
              onBack={navigationHistory.canGoBack ? goBack : undefined}
              onWorkspace={() => {
                const previous = workspaceReturn.current;
                if (
                  (previous.kind === "task" && !opened.includes(previous.id)) ||
                  (previous.kind === "file" &&
                    !fileWorkspace.files.some((f) => f.id === previous.id))
                ) {
                  navigate("tasks");
                } else activateLocation(previous);
              }}
              onNavigate={(p) => {
                if (sectionFor(p) !== sectionFor(visiblePage))
                  setProject("all");
                navigate(p);
              }}
              taskId={task?.project === visibleProject ? task.id : undefined}
              activePath={activeFile?.path}
              fileVersion={fileWorkspace.version}
              onOpenFile={
                task?.deviceId && !activeFile
                  ? undefined
                  : (p, path, mode, originalPath) => {
                      void fileWorkspace.open(p, path, mode, originalPath);
                    }
              }
              onProject={setProject}
              onNewProject={(path) => beginNewTask(path)}
              onAddProject={() => void addProject()}
              onSearch={() => setSearchOpen(true)}
              onExpand={() => setSidebar(true)}
            />
            <main
              tabIndex={-1}
              className="flex min-w-0 flex-1 flex-col outline-none"
            >
              <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-4">
                <IconButton
                  label={sidebar ? "收起侧边栏" : "展开侧边栏"}
                  onClick={() => setSidebar(!sidebar)}
                >
                  {sidebar ? <PanelLeftClose /> : <PanelLeftOpen />}
                </IconButton>
                <nav
                  aria-label="面包屑"
                  className="flex min-w-0 items-center gap-2 text-xs"
                >
                  <span className="shrink-0 text-muted-foreground">
                    {
                      sections.find((s) => s.id === sectionFor(visiblePage))
                        ?.name
                    }
                  </span>
                  <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                  {activeFile ? (
                    <>
                      <button
                        className="max-w-36 truncate text-muted-foreground hover:text-foreground"
                        title={activeFile.project}
                        onClick={() => {
                          setProject(activeFile.project);
                          navigate("tasks");
                        }}
                      >
                        {projectName(activeFile.project)}
                      </button>
                      <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                      <span
                        aria-current="page"
                        className="truncate font-medium"
                        title={activeFile.path}
                      >
                        {activeFile.path}
                      </span>
                    </>
                  ) : task ? (
                    <>
                      <button
                        className="max-w-36 truncate text-muted-foreground hover:text-foreground"
                        title={task.project}
                        onClick={() => {
                          setProject(task.deviceId ? "all" : task.project);
                          navigate(visiblePage);
                        }}
                      >
                        {projectName(task.project)}
                      </button>
                      <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                      <span
                        aria-current="page"
                        className="truncate font-medium"
                        title={task.title}
                      >
                        {task.title}
                      </span>
                    </>
                  ) : (
                    <>
                      <span
                        aria-current={
                          project === "all" ||
                          !["tasks", "history", "stats"].includes(page)
                            ? "page"
                            : undefined
                        }
                        className="truncate font-medium"
                      >
                        {title}
                      </span>
                      {project !== "all" &&
                        ["tasks", "history", "stats"].includes(page) && (
                          <>
                            <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                            <span
                              aria-current="page"
                              className="max-w-36 truncate text-muted-foreground"
                              title={project}
                            >
                              {projectName(project)}
                            </span>
                          </>
                        )}
                    </>
                  )}
                </nav>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="页面导航"
                      className="md:hidden"
                    >
                      <Menu />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {Object.entries(pageNames).map(([id, name]) => (
                      <DropdownMenuItem
                        key={id}
                        onSelect={() => navigate(id as Page)}
                      >
                        {name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <div className="flex-1" />
                {!desktop && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] font-normal"
                  >
                    演示数据 · 不连接本机
                  </Badge>
                )}
                <IconButton
                  label="同步历史记录"
                  disabled={refreshing}
                  onClick={() =>
                    void refresh(true).catch((e) => toast.error(String(e)))
                  }
                >
                  <RefreshCw className={refreshing ? "animate-spin" : ""} />
                </IconButton>
              </header>
              <TaskTabs
                tasks={opened
                  .map((id) => snapshot.tasks.find((t) => t.id === id))
                  .filter((t): t is Task => !!t)}
                selected={selected}
                files={fileWorkspace.files}
                selectedFile={fileWorkspace.selected}
                onSelectFile={fileWorkspace.select}
                onCloseFile={closeFile}
                onSelect={(id) => {
                  const target = snapshot.tasks.find((t) => t.id === id);
                  if (!target) return;
                  fileWorkspace.select(null);
                  setSelected(id);
                  setDetailTrail([]);
                }}
                onClose={closeTab}
                onCloseMany={(tabs) => void closeMany(tabs)}
                onNew={() => navigate("new")}
              />
              {error && (
                <div
                  role="alert"
                  className="flex items-center gap-2 border-b bg-red-50 px-5 py-3 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300"
                >
                  <AlertCircle className="size-4" />
                  {error}
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => void refresh(true).catch(() => {})}
                  >
                    重试
                  </Button>
                </div>
              )}
              <div
                ref={pageTransition}
                className={cn(
                  "min-h-0 flex-1",
                  task || activeFile ? "overflow-hidden" : "overflow-y-auto",
                )}
              >
                <Suspense fallback={<Loading />}>
                  {loading && <Loading />}
                  {activeFile && (
                    <div
                      id={`file-panel-${activeFile.id}`}
                      role="tabpanel"
                      aria-labelledby={`file-tab-${activeFile.id}`}
                      className="h-full min-h-0"
                    >
                      <PaneBoundary key={activeFile.id} label="文件编辑器">
                        <Suspense fallback={<Loading />}>
                          <FileEditor
                            file={activeFile}
                            onChange={(content) =>
                              fileWorkspace.update(activeFile.id, (f) => ({
                                ...f,
                                content,
                              }))
                            }
                            onSave={() =>
                              void fileWorkspace.save(activeFile.id)
                            }
                            onReload={() =>
                              void fileWorkspace.reload(activeFile.id)
                            }
                            onOpen={(p, path, mode) =>
                              void fileWorkspace.open(p, path, mode)
                            }
                            onResolve={(useDisk) =>
                              fileWorkspace.update(activeFile.id, (f) =>
                                f.conflict
                                  ? {
                                      ...f,
                                      content: useDisk
                                        ? f.conflict.content
                                        : f.content,
                                      saved: f.conflict.content,
                                      revision: f.conflict.revision,
                                      conflict: undefined,
                                    }
                                  : f,
                              )
                            }
                          />
                        </Suspense>
                      </PaneBoundary>
                    </div>
                  )}
                  {!loading &&
                    opened
                      .map((id) => snapshot.tasks.find((t) => t.id === id))
                      .filter((t): t is Task => !!t)
                      .map((openTask) => (
                        <div
                          key={openTask.id}
                          id={`task-panel-${openTask.id}`}
                          role="tabpanel"
                          aria-labelledby={`task-tab-${openTask.id}`}
                          hidden={!!activeFile || selected !== openTask.id}
                          className="h-full min-h-0"
                        >
                          <DetailPage
                            task={openTask}
                            onNewTask={() =>
                              beginNewTask(openTask.project, openTask)
                            }
                            tasks={snapshot.tasks}
                            agents={
                              openTask.deviceId
                                ? remote.devices.find(
                                    (d) => d.id === openTask.deviceId,
                                  )?.snapshot?.agents || []
                                : snapshot.agents
                            }
                            profiles={
                              openTask.deviceId ? [] : snapshot.providers || []
                            }
                            active={!activeFile && selected === openTask.id}
                            onBack={() => {
                              const previous = detailTrail.at(-1);
                              setSelected(previous || null);
                              setDetailTrail((trail) => trail.slice(0, -1));
                            }}
                            onOpen={open}
                            onOpenFile={
                              openTask.deviceId ? undefined : fileWorkspace.open
                            }
                            onChanged={() =>
                              openTask.deviceId ? remote.refresh() : refresh()
                            }
                            onRetry={retry}
                          />
                        </div>
                      ))}
                  {!loading && !task && !activeFile && (
                    <div key={page} className="min-h-full">
                      {page === "guide" && (
                        <GuidePage
                          snapshot={snapshot}
                          onNavigate={(p) => {
                            if (sectionFor(p) !== sectionFor(page))
                              setProject("all");
                            navigate(p);
                          }}

                          onAddProject={() => void addProject()}
                          onDismiss={() => {
                            localStorage.setItem("oiagent-onboarded", "true");
                            navigate("tasks");
                          }}
                        />
                      )}
                      {(page === "tasks" || page === "history") && (
                        <TasksPage
                          key={page}
                          snapshot={snapshot}
                          project={project}
                          history={page === "history"}
                          onProject={setProject}
                          onOpen={open}
                          onNew={() => navigate("new")}
                          onHistory={() => navigate("history")}
                          onRestore={async (t) => {
                            try {
                              await call("archive_task", {
                                id: t.id,
                                archived: false,
                              });
                              await refresh();
                              toast.success("记录已恢复");
                            } catch (e) {
                              toast.error(String(e));
                            }
                          }}
                        />
                      )}
                      {page === "stats" && (
                        <StatsPage snapshot={snapshot} project={project} />
                      )}{" "}
                      {(page === "new" || page === "supervisor") && (
                        <NewTaskPage
                          key={`${page}-${seed?.id || "new"}-${newTaskKey}`}
                          snapshot={snapshot}
                          project={project}
                          seed={seed}
                          supervisor={page === "supervisor"}
                          onCreated={created}
                          draft={draft}
                          onDraftChange={setDraft}
                          onSettings={(value) =>
                            leaveDraft("settings-llm", value)
                          }
                          onAgents={(value) => leaveDraft("agents", value)}
                        />
                      )}{" "}
                      {(page === "agents" || page === "plugins") && (
                        <AgentsPage
                          key={page}
                          snapshot={snapshot}
                          onRefresh={refresh}
                          plugins={page === "plugins"}
                          onClaudeApi={() => setPage("claude-api")}
                          onIntegrations={(kind) => {
                            setIntegrationKind(kind);
                            setPage("integrations");
                          }}
                          onBack={
                            returnToDraft
                              ? () => {
                                  setPage(returnToDraft);
                                  setReturnToDraft(null);
                                }
                              : undefined
                          }
                        />
                      )}{" "}
                      {page === "integrations" && (
                        <IntegrationsPage
                          snapshot={snapshot}
                          initialKind={integrationKind}
                          onBack={() => setPage("agents")}
                        />
                      )}
                      {page === "claude-api" && (
                        <div className="mx-auto w-full max-w-6xl p-5 lg:p-8">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="mb-4 -ml-2"
                            onClick={() => setPage("agents")}
                          >
                            返回 Agent 程序
                          </Button>
                          <ProviderManager
                            profiles={snapshot.providers || []}
                            onChanged={() => refresh()}
                          />
                        </div>
                      )}
                      {page === "settings-lan" && (
                        <LanSettingsPage
                          snapshot={localSnapshot}
                          devices={remote.devices}
                          onChanged={remote.refresh}
                        />
                      )}
                      {isSettingsPage(page) && page !== "settings-lan" && (
                        <>
                          {returnToDraft && (
                            <Button
                              variant="ghost"
                              className="ml-6 mt-4"
                              onClick={() => {
                                setPage(returnToDraft);
                                setReturnToDraft(null);
                              }}
                            >
                              返回新建任务
                            </Button>
                          )}
                          <SettingsPage
                            page={page}
                            llmDraft={llmDraft}
                            onLlmDraft={setLlmDraft}
                            dataDir={snapshot.dataDir}
                            autoRefresh={autoRefresh}
                            setAutoRefresh={(v) => {
                              setAuto(v);
                              localStorage.setItem(
                                "oiagent-refresh",
                                String(v),
                              );
                            }}
                          />
                        </>
                      )}
                    </div>
                  )}
                </Suspense>
              </div>
            </main>
          </div>
          <footer className="flex h-6 shrink-0 items-center gap-4 border-t bg-card px-4 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              {desktop ? "本地连接" : "演示模式"}
            </span>
            <span>{active.length} 个活跃任务</span>
            <span className="ml-auto">
              {refreshing
                ? "正在同步…"
                : snapshot.warnings.length
                  ? `${snapshot.warnings.length} 个目录读取提示`
                  : null}
            </span>
          </footer>
        </div>
        <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
          <DialogContent className="max-h-[80vh] overflow-hidden p-0 sm:max-w-xl">
            <DialogHeader className="px-5 pt-5">
              <DialogTitle className="flex items-center gap-2 text-sm">
                <Command className="size-4" />
                搜索工作区
              </DialogTitle>
              <DialogDescription className="sr-only">
                搜索任务名称、预览和项目目录
              </DialogDescription>
            </DialogHeader>
            <div className="px-5">
              <Input
                autoFocus
                aria-label="全局搜索"
                placeholder="搜索任务、内容或项目…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="max-h-96 overflow-auto px-2 pb-3">
              {filterTasks(snapshot.tasks, query)
                .slice(0, 40)
                .map((t) => (
                  <button
                    key={t.id}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-muted"
                    onClick={() => open(t)}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{t.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {projectName(t.project)}
                      </p>
                    </div>
                    <StatusBadge status={t.status} />
                    <ArrowUpRight className="size-3.5 text-muted-foreground" />
                  </button>
                ))}
              {!filterTasks(snapshot.tasks, query).length && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  没有找到匹配的任务
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>
        <Dialog
          open={!!fileWorkspace.closing}
          onOpenChange={(open) => {
            if (!open && !closingFile?.saving) fileWorkspace.cancelClose();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>保存文件修改？</DialogTitle>
              <DialogDescription>
                {
                  fileWorkspace.files.find(
                    (f) => f.id === fileWorkspace.closing,
                  )?.path
                }{" "}
                有未保存的内容。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="ghost"
                disabled={closingFile?.saving}
                onClick={fileWorkspace.cancelClose}
              >
                取消
              </Button>
              <Button
                variant="outline"
                disabled={closingFile?.saving}
                onClick={() => {
                  if (fileWorkspace.closing) discardFile(fileWorkspace.closing);
                }}
              >
                不保存并关闭
              </Button>
              <Button
                disabled={closingFile?.saving}
                onClick={async () => {
                  const id = fileWorkspace.closing;
                  if (id && (await fileWorkspace.save(id))) discardFile(id);
                }}
              >
                保存并关闭
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Toaster position="bottom-right" richColors />
      </TooltipProvider>
    </MotionConfig>
  );
}
