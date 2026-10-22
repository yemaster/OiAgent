import { ProjectTerminal } from "@/components/workspace/ProjectTerminal";
import {
  readWorkspaceSession,
  writeWorkspaceSession,
} from "@/lib/workspaceSession";
import { newerTask } from "@/lib/taskState";
import { WorkspaceStatusBar } from "@/components/workspace/WorkspaceStatusBar";
import {
  useShortcuts,
  shortcutDefinitions,
  matchesShortcut,
} from "@/lib/shortcuts";
import { useBackgroundUpdateCheck } from "@/lib/appUpdates";
import { useProjectDrop } from "@/hooks/useProjectDrop";
import { WindowTitlebar } from "@/components/workspace/WindowTitlebar";
import { projectChoices } from "@/lib/temporaryProjects";
import { CloseApplication } from "@/components/workspace/CloseApplication";
import { dirtyFile, imageFile } from "@/lib/files";
import { ImageEditorContext } from "@/lib/imageEditor";
import { ProjectImageDialog } from "@/components/workspace/ImageDialog";
import { useExtensions } from "@/hooks/useExtensions";
import { ExtensionIcon } from "@/components/extensions/ExtensionIcon";
import { useWorkspaceOrganization } from "@/hooks/useWorkspaceOrganization";
import { OrganizationContext, projectMarkKey } from "@/lib/organization";
import { useWorkflows } from "@/hooks/useWorkflows";
import { WorkflowsPage } from "@/pages/Workflows";
import { WorkflowEditorPage } from "@/pages/WorkflowEditor";
import { newWorkflow, type WorkflowDefinition } from "@/lib/workflows";
import {
  InstructionsPage,
  type InstructionContext,
} from "@/pages/Instructions";
import { TemporaryProjectMenu } from "@/components/workspace/TemporaryProjectMenu";
import { integrationKinds, type IntegrationContext } from "@/lib/integrations";
import { useEditorGroups } from "@/hooks/useEditorGroups";
import {
  EditorWorkspace,
  EditorPane,
} from "@/components/workspace/EditorWorkspace";
import type { SplitSide } from "@/lib/editorGroups";
import { useNavigationHistory } from "@/hooks/useNavigationHistory";
import { newTaskDraft } from "@/lib/newTask";
import { useTodos } from "@/hooks/useTodos";
import { TodosPage } from "@/pages/Todos";
import { TodoEditorPage } from "@/pages/TodoEditor";
import {
  taskFromTodo,
  todoPrompt,
  type Todo,
  type TodoEditor,
} from "@/lib/todos";
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
import { useNativeMenu } from "@/hooks/useNativeMenu";
import { useFiles } from "@/hooks/useFiles";
import {
  useTabHistory,
  type TabLocation,
  type WorkspaceLocation,
  type PageLocation,
} from "@/hooks/useTabHistory";
import { useRecentProjects } from "@/hooks/useRecentProjects";
import { ProviderManager } from "@/components/workspace/ProviderManager";
import { ProviderEditor } from "@/pages/ProviderEditor";
import { providerDraft, type ProviderDraft } from "@/lib/providers";
import type { TaskDraft } from "@/lib/permissions";
import { AppearanceProvider } from "@/components/AppearanceProvider";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
  ChevronRight,
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
  SquareTerminal,
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
const PluginsPage = lazy(() =>
  import("@/pages/Plugins").then((m) => ({ default: m.PluginsPage })),
);
const ExtensionViewPage = lazy(() =>
  import("@/pages/ExtensionView").then((m) => ({
    default: m.ExtensionViewPage,
  })),
);
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
  const [projectTerminalOpen, setProjectTerminalOpen] = useState(false);
  const [restoredSession] = useState(readWorkspaceSession);
  const extensions = useExtensions(
    restoredSession?.extensions,
    restoredSession?.selectedExtension,
  );
  const [managedPluginId, setManagedPluginId] = useState<string>();
  const fileWorkspace = useFiles(
    restoredSession?.files,
    restoredSession?.selectedFile,
  );
  const activeFile = fileWorkspace.active;
  const [localSnapshot, setSnapshot] = useState<Snapshot>(empty);
  const remote = useRemoteDevices();
  const snapshot: Snapshot = {
    ...localSnapshot,
    projects: projectChoices(localSnapshot),
    tasks: [...localSnapshot.tasks, ...remote.tasks],
    remoteDevices: remote.devices,
  };
  const [page, setPage] = useState<Page>(restoredSession?.page || "new");
  const [startupResolved, setStartupResolved] = useState(false);
  const [project, setProject] = useState(restoredSession?.project || "all");
  const [selected, setSelected] = useState<string | null>(
    restoredSession?.selected || null,
  );
  const [detailTrail, setDetailTrail] = useState<string[]>([]);
  const [seed, setSeed] = useState<Task>();
  const [opened, setOpened] = useState<string[]>(restoredSession?.opened || []);
  const [instructionContext, setInstructionContext] =
    useState<InstructionContext>(
      restoredSession?.instructionContext || { kind: "codex", project: "user" },
    );
  const [integrationKind, setIntegrationKind] = useState<string | undefined>(
    restoredSession?.integrationKind,
  );
  const [providerEdit, setProviderEdit] = useState<ProviderDraft | null>(null);
  const providerEditRef = useRef(providerEdit);
  useLayoutEffect(() => {
    providerEditRef.current = providerEdit;
  }, [providerEdit]);
  const [integrationContext, setIntegrationContext] = useState<
    IntegrationContext | undefined
  >(restoredSession?.integrationContext);
  const [draft, setDraft] = useState<TaskDraft>();
  const workflows = useWorkflows(
    page === "supervisor" || page === "workflow-edit",
  );
  const { setEditorId: setWorkflowEditorId } = workflows;
  const todos = useTodos(page === "todos" || page.startsWith("todos-"));
  const { setEditorId: setTodoEditorId } = todos;
  const todoViewRef = useRef({ page, editorId: todos.editorId });
  useLayoutEffect(() => {
    todoViewRef.current = { page, editorId: todos.editorId };
  }, [page, todos.editorId]);
  const [pendingTodo, setPendingTodo] = useState<Todo | null>(null);
  const [newTaskKey, setNewTaskKey] = useState(0);
  const [taskToolbarTarget, setTaskToolbarTarget] =
    useState<HTMLDivElement | null>(null);
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
  const startupHasTasks = snapshot.tasks.some(
    (task) => !task.archived && isActive(task),
  );
  useLayoutEffect(() => {
    if (startupResolved || loading || (!startupHasTasks && !remote.ready))
      return;
    // Resolve asynchronously loaded startup state once, without interrupting later navigation.
    // oxlint-disable-next-line react/set-state-in-effect
    setStartupResolved(true);
    setPage((current) =>
      !restoredSession && current === "new"
        ? startupHasTasks
          ? "tasks"
          : "new"
        : current,
    );
  }, [
    startupResolved,
    loading,
    startupHasTasks,
    remote.ready,
    restoredSession,
  ]);
  const refreshingRef = useRef(false);
  const pendingRefresh = useRef<Promise<Snapshot> | null>(null);
  const refresh = useCallback(async (scan = false, cached = false) => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const request = call<Snapshot>("get_snapshot", { scan, cached });
      pendingRefresh.current = request;
      const loaded = await request;
      setSnapshot((current) => {
        const previous = new Map(current.tasks.map((task) => [task.id, task]));
        return {
          ...loaded,
          tasks: loaded.tasks.map((task) =>
            newerTask(previous.get(task.id) || task, task),
          ),
        };
      });
      setError("");
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      pendingRefresh.current = null;
      refreshingRef.current = false;
      setRefreshing(false);
      setLoading(false);
    }
  }, []);
  const refreshOrganization = async () => {
    // A mutation needs a new snapshot even when an older poll is in flight.
    await pendingRefresh.current?.catch(() => {});
    await refresh(false, true);
    await remote.refresh(true);
  };
  const organization = useWorkspaceOrganization(refreshOrganization);

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
        tasks: [
          newerTask(s.tasks.find((x) => x.id === t.id) || t, t),
          ...s.tasks.filter((x) => x.id !== t.id),
        ],
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
  const activeExtension =
    !activeFile && !task
      ? extensions.tabs.find((t) => t.id === extensions.selected)
      : undefined;
  const { select: selectExtension, close: removeExtensionTab } = extensions;
  const location: WorkspaceLocation = activeExtension
    ? { kind: "extension", id: activeExtension.id }
    : activeFile
      ? { kind: "file", id: activeFile.id, taskId: task?.id }
      : task
        ? { kind: "task", id: task.id }
        : {
            kind: "page",
            page,
            project,
            ...(page === "integrations"
              ? { integrationKind, integrationContext }
              : {}),
            ...(page === "instructions" ? { instructionContext } : {}),
            ...(page === "workflow-edit"
              ? { workflowEditorId: workflows.editorId || undefined }
              : {}),
            ...(page === "todos-edit"
              ? { todoEditorId: todos.editorId || undefined }
              : {}),
            ...(page === "claude-api-edit"
              ? { providerEditorId: providerEdit?.sessionId }
              : {}),
          };
  const currentEditorKey =
    location.kind === "page" ? "page" : `${location.kind}:${location.id}`;
  const editorLayout = useEditorGroups(
    [
      "page",
      ...opened
        .filter((id) => snapshot.tasks.some((t) => t.id === id))
        .map((id) => `task:${id}`),
      ...fileWorkspace.files.map((f) => `file:${f.id}`),
      ...extensions.tabs.map((t) => `extension:${t.id}`),
    ],
    currentEditorKey,
    restoredSession?.layout,
    startupResolved && !loading && remote.ready && extensions.ready,
  );
  useEffect(() => {
    if (!startupResolved || loading || !remote.ready || !extensions.ready)
      return;
    const ephemeral = new Set(
      snapshot.temporaryProjects
        ?.filter((project) => project.ephemeral)
        .map((project) => project.path),
    );
    const keptTasks = opened.filter((id) =>
      snapshot.tasks.some(
        (task) => task.id === id && !ephemeral.has(task.project),
      ),
    );
    const files = fileWorkspace.files.filter(
      (file) => !ephemeral.has(file.project),
    );
    writeWorkspaceSession({
      version: 1,
      page,
      project: ephemeral.has(project) ? "all" : project,
      opened: keptTasks,
      selected: selected && keptTasks.includes(selected) ? selected : null,
      selectedFile:
        selectedFileId && files.some((file) => file.id === selectedFileId)
          ? selectedFileId
          : null,
      files,
      layout: editorLayout.layout,
      extensions: extensions.tabs.filter(
        (tab) => !tab.context.project || !ephemeral.has(tab.context.project),
      ),
      selectedExtension: extensions.selected,
      integrationKind,
      integrationContext,
      instructionContext,
    });
  }, [
    startupResolved,
    loading,
    remote.ready,
    page,
    project,
    opened,
    selected,
    selectedFileId,
    fileWorkspace.files,
    editorLayout.layout,
    snapshot.temporaryProjects,
    snapshot.tasks,
    extensions.ready,
    extensions.tabs,
    extensions.selected,
    integrationKind,
    integrationContext,
    instructionContext,
  ]);
  const editorPageAvailable = (next: WorkspaceLocation) => {
    if (next.kind !== "page") return true;
    if (next.page === "workflow-edit")
      return (
        !!next.workflowEditorId && !!workflows.editors[next.workflowEditorId]
      );
    if (next.page === "todos-edit")
      return !!next.todoEditorId && !!todos.editors[next.todoEditorId];
    return (
      next.page !== "claude-api-edit" ||
      (!!providerEdit && providerEdit.sessionId === next.providerEditorId)
    );
  };
  const lastPageLocation = useRef<PageLocation>({
    kind: "page",
    page: restoredSession?.page || "tasks",
    project: restoredSession?.project || "all",
    integrationKind: restoredSession?.integrationKind,
    integrationContext: restoredSession?.integrationContext,
    instructionContext: restoredSession?.instructionContext,
  });
  useLayoutEffect(() => {
    if (location.kind === "page") lastPageLocation.current = location;
  });
  const candidatePage =
    location.kind === "page" ? location : lastPageLocation.current;
  const pinnedPage: PageLocation = editorPageAvailable(candidatePage)
    ? candidatePage
    : { kind: "page", page: "tasks", project: "all" };
  const pinnedProject =
    pinnedPage.project !== "all" &&
    sectionFor(pinnedPage.page) === "workspace" &&
    pinnedPage.page !== "guide";
  function exitProject() {
    setStartupResolved(true);
    activateLocation({ kind: "page", page: "tasks", project: "all" });
  }
  const pinnedPageRef = useRef(pinnedPage);
  useLayoutEffect(() => {
    pinnedPageRef.current = pinnedPage;
  });
  const { afterClose: afterGroupClose } = editorLayout;
  const afterClose = useTabHistory(
    location,
    [
      ...opened
        .filter((id) => snapshot.tasks.some((t) => t.id === id))
        .map((id) => `task:${id}`),
      ...fileWorkspace.files.map((f) => `file:${f.id}`),
      ...extensions.tabs.map((t) => `extension:${t.id}`),
    ],
    editorPageAvailable,
  );
  const activateLocation = useCallback(
    (next: WorkspaceLocation, closed?: TabLocation, focus = true) => {
      setDetailTrail([]);
      selectExtension(next.kind === "extension" ? next.id : null);
      if (next.kind === "extension") {
        selectFile(null);
        setSelected(null);
      } else if (next.kind === "file") {
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
        if (next.page === "workflow-edit" && next.workflowEditorId)
          setWorkflowEditorId(next.workflowEditorId);
        if (next.page === "todos-edit" && next.todoEditorId)
          setTodoEditorId(next.todoEditorId);
        setProject(next.project);
        if (next.page === "integrations") {
          setIntegrationKind(next.integrationKind);
          setIntegrationContext(next.integrationContext);
        }
        if (next.page === "instructions" && next.instructionContext)
          setInstructionContext(next.instructionContext);
      }
      if (!focus) return;
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
    [
      opened,
      selectFile,
      setDetailTrail,
      setSelected,
      setPage,
      setProject,
      setIntegrationKind,
      setIntegrationContext,
      setInstructionContext,
      setTodoEditorId,
      setWorkflowEditorId,
      selectExtension,
    ],
  );
  function editorLocation(key: string): WorkspaceLocation {
    if (key === "page") return pinnedPage;
    const separator = key.indexOf(":");
    return {
      kind: key.slice(0, separator) as TabLocation["kind"],
      id: key.slice(separator + 1),
    };
  }
  function selectEditor(key: string) {
    if (key !== currentEditorKey)
      activateLocation(editorLocation(key), undefined, false);
  }
  function moveEditor(
    key: string,
    group: string,
    side?: SplitSide,
    before?: string,
  ) {
    const source = editorLayout.groups.find((g) => g.tabs.includes(key));
    editorLayout.move(key, group, side, before);
    if (side || !before || source?.id !== group) selectEditor(key);
  }
  const navigationHistory = useNavigationHistory(
    {
      location,
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
        : location.kind === "extension"
          ? extensions.tabs.some((t) => t.id === location.id)
          : location.kind === "file"
            ? fileWorkspace.files.some((f) => f.id === location.id)
            : editorPageAvailable(location),
    !loading && (startupResolved || !startupHasTasks),
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
      const groupNext = afterGroupClose(`${closed.kind}:${closed.id}`);
      let preferred: WorkspaceLocation | undefined;
      if (groupNext === "page") preferred = pinnedPageRef.current;
      else if (groupNext) {
        const separator = groupNext.indexOf(":");
        preferred = {
          kind: groupNext.slice(0, separator) as TabLocation["kind"],
          id: groupNext.slice(separator + 1),
        };
      }
      const next = afterClose(closed, preferred);
      if (next) activateLocation(next, closed);
    },
    [afterClose, activateLocation, afterGroupClose],
  );
  const closingConversations = useRef(new Set<string>());
  const closeTab = useCallback(
    async (id: string) => {
      const closingTask = localSnapshot.tasks.find((task) => task.id === id);
      const disposable =
        !closingTask?.parentId &&
        localSnapshot.temporaryProjects?.find(
          (p) => p.ephemeral && p.path === closingTask?.project,
        );
      let ids = [id];
      if (disposable) {
        if (closingConversations.current.has(disposable.id)) return false;
        closingConversations.current.add(disposable.id);
        try {
          await call("destroy_temporary_conversation", { id: disposable.id });
          ids = localSnapshot.tasks
            .filter(
              (t) =>
                t.project === disposable.path ||
                t.project.startsWith(disposable.path + "/"),
            )
            .map((t) => t.id);
          for (const file of fileWorkspace.files.filter(
            (f) =>
              f.project === disposable.path ||
              f.project.startsWith(disposable.path + "/"),
          )) {
            discardFileBuffer(file.id);
            afterClose({ kind: "file", id: file.id });
          }
          for (const other of ids.filter((other) => other !== id))
            afterClose({ kind: "task", id: other });
          setSnapshot((snapshot) => ({
            ...snapshot,
            tasks: snapshot.tasks.filter((t) => !ids.includes(t.id)),
            projects: snapshot.projects.filter((p) => p !== disposable.path),
            temporaryProjects: snapshot.temporaryProjects?.map((p) =>
              p.id === disposable.id ? { ...p, status: "cleaned" as const } : p,
            ),
          }));
          setProject((p) => (p === disposable.path ? "all" : p));
        } catch (error) {
          toast.error(String(error));
          return false;
        } finally {
          closingConversations.current.delete(disposable.id);
        }
      }
      setOpened((open) => open.filter((t) => !ids.includes(t)));
      setDetailTrail((trail) => trail.filter((t) => !ids.includes(t)));
      if (selected && ids.includes(selected)) setSelected(null);
      restoreAfterClose({ kind: "task", id });
      return true;
    },
    [
      selected,
      restoreAfterClose,
      setDetailTrail,
      setSelected,
      setOpened,
      localSnapshot.tasks,
      localSnapshot.temporaryProjects,
      fileWorkspace.files,
      discardFileBuffer,
      afterClose,
    ],
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
  const closeExtension = useCallback(
    (id: string) => {
      removeExtensionTab(id);
      restoreAfterClose({ kind: "extension", id });
    },
    [removeExtensionTab, restoreAfterClose],
  );
  function openExtension(pluginId: string, viewId: string) {
    extensions.open(
      pluginId,
      viewId,
      activeExtension?.context || {
        project: task?.deviceId
          ? null
          : activeFile?.project ||
            task?.project ||
            (project === "all" ? null : project),
        taskId: task?.id || null,
      },
    );
    selectFile(null);
    setSelected(null);
    setDetailTrail([]);
    setSearchOpen(false);
  }
  const closingBatch = useRef(false);
  async function closeMany(tabs: TabLocation[]) {
    if (closingBatch.current || fileWorkspace.closing) return;
    closingBatch.current = true;
    const isCurrent = (tab: TabLocation) =>
      activeExtension
        ? tab.kind === "extension" && tab.id === activeExtension.id
        : activeFile
          ? tab.kind === "file" && tab.id === activeFile.id
          : tab.kind === "task" && tab.id === selected;
    const ordered = [...tabs].sort(
      (a, b) => Number(isCurrent(a)) - Number(isCurrent(b)),
    );
    try {
      for (const tab of ordered) {
        if (tab.kind === "task") {
          if (!(await closeTab(tab.id))) break;
        } else if (tab.kind === "extension") closeExtension(tab.id);
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
    setStartupResolved(true);
    selectExtension(null);
    const contextTask =
      explicitTask || (!explicitProject && !activeFile ? task : undefined);
    const directory =
      explicitProject ||
      (activeFile?.instruction
        ? activeFile.instruction.scope.project || "all"
        : activeFile?.skill
          ? activeFile.skill.scope.project || "all"
          : activeFile?.project) ||
      contextTask?.project ||
      project;
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
  function editWorkflow(definition: WorkflowDefinition) {
    workflows.open(definition, project);
    navigate("workflow-edit");
  }
  const draggingProject = useProjectDrop(
    (path) => {
      const previous = draft;
      beginNewTask(path);
      if (previous) {
        setDraft(
          (next) =>
            next && {
              ...(previous.deviceId === "local" ? previous : next),
              prompt: previous.prompt,
              title: previous.title,
              dir: path,
              deviceId: "local",
              temporary: false,
              ephemeral: false,
              temporaryPath: undefined,
              resume: false,
            },
        );
      }
      void refresh().catch((error) => toast.error(String(error)));
    },
    () =>
      !!fileWorkspace.closing ||
      !!document.querySelector(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
      ),
  );
  function editTodo(item?: Todo, parent?: Todo) {
    todos.openEditor(
      item,
      parent,
      page === "todos-completed" ? "todos-completed" : "todos",
    );
    navigate("todos-edit");
  }
  function finishTodoEditor(editor: TodoEditor) {
    todos.removeEditor(editor.sessionId);
    if (
      todoViewRef.current.page === "todos-edit" &&
      todoViewRef.current.editorId === editor.sessionId
    )
      navigate(editor.returnPage);
  }
  function fillTodoTask(item: Todo, append = false) {
    if (item.completedAt) return;
    const next =
      append && draft
        ? {
            ...draft,
            prompt: `${draft.prompt.trimEnd()}\n\n${todoPrompt(item, todos.list?.items)}`,
            title: draft.title || item.title,
          }
        : taskFromTodo(localSnapshot, item, todos.list?.items);
    beginNewTask(next.dir || "all");
    setDraft(next);
    setPendingTodo(null);
  }
  function createTodoTask(item: Todo) {
    if (
      draft &&
      [
        draft.prompt,
        draft.title,
        draft.command,
        draft.argsText,
        draft.envText,
      ].some((value) => value.trim())
    ) {
      setPendingTodo(item);
    } else fillTodoTask(item);
  }
  const shortcuts = useShortcuts();
  function handleMenuAction(action: string) {
    if (
      fileWorkspace.closing ||
      document.querySelector('[role="dialog"][data-state="open"]')
    )
      return;
    switch (action) {
      case "new-task":
        beginNewTask();
        break;
      case "add-project":
        void addProject();
        break;
      case "close-project":
        if (pinnedProject) exitProject();
        break;
      case "find-conversation":
      case "task-info":
      case "task-artifacts":
      case "task-processes":
        if (task && !activeFile && !activeExtension)
          window.dispatchEvent(new CustomEvent("oiagent-task-menu", { detail: { id: task.id, action } }));
        break;
      case "save-file":
        if (selectedFileId) void saveFile(selectedFileId);
        break;
      case "close-tab":
        if (activeExtension) closeExtension(activeExtension.id);
        else if (selectedFileId) closeFile(selectedFileId);
        else if (selected) closeTab(selected);
        else if (pinnedProject) exitProject();
        break;
      case "search":
        setSearchOpen(true);
        break;
      case "open-project-terminal":
        if (terminalProject) {
          setProjectTerminalOpen(true);
          window.dispatchEvent(new CustomEvent("oiagent-project-terminal", { detail: "focus" }));
        }
        break;
      case "toggle-project-terminal":
        if (terminalProject) setProjectTerminalOpen((value) => !value);
        break;
      case "toggle-sidebar":
        setSidebar((value) => !value);
        break;
      case "back":
        goBack();
        break;
      case "refresh":
        void refresh(true).catch((error) => toast.error(String(error)));
        break;
      case "supervisor":
      case "tasks":
      case "todos":
      case "history":
      case "archived":
      case "stats":
      case "agents":
      case "instructions":
      case "claude-api":
      case "settings-shortcuts":
      case "settings-appearance":
      case "integrations":
      case "plugins":
      case "settings":
      case "settings-about":
      case "guide":
        navigate(action);
        break;
    }
  }
  const handleKeyboardAction = useEffectEvent((action: string) =>
    handleMenuAction(action),
  );
  useEffect(() => {
    // Desktop accelerators are dispatched by the native application menu.
    if (desktop) return;
    function key(e: KeyboardEvent) {
      if (
        e.defaultPrevented ||
        e.isComposing ||
        e.repeat ||
        (e.target instanceof Element &&
          e.target.closest("[data-terminal-surface], [data-shortcut-recorder]"))
      )
        return;
      const action = shortcutDefinitions.find(
        ({ id }) =>
          ![
            "send",
            "newline",
            "move-tab-left",
            "move-tab-right",
            "find-conversation",
          ].includes(id) && matchesShortcut(e, shortcuts[id]),
      );
      if (!action) return;
      e.preventDefault();
      handleKeyboardAction(action.id);
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [shortcuts]);
  const active = snapshot.tasks.filter((t) => isActive(t) && !t.archived);
  function configureProject(
    path: string,
    page: "instructions" | "integrations",
  ) {
    if (page === "instructions")
      setInstructionContext((current) => ({ ...current, project: path }));
    else
      setIntegrationContext((current) => ({
        kind:
          current?.kind ||
          integrationKind ||
          snapshot.agents.find(
            (agent) => agent.available && integrationKinds.includes(agent.kind),
          )?.kind ||
          "codex",
        project: path,
        tab: current?.tab || "mcp",
      }));
    setProject(path);
    navigate(page);
  }
  function navigate(p: Page) {
    setStartupResolved(true);
    selectExtension(null);
    if (p === "new") {
      beginNewTask();
      return;
    }
    fileWorkspace.select(null);
    if (
      returnToDraft &&
      (["agents", "claude-api", "claude-api-edit", "integrations"].includes(
        p,
      ) ||
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
    setStartupResolved(true);
    selectExtension(null);
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
    selectExtension(null);
    fileWorkspace.select(null);
    if (t.source !== "workflow") setDraft(undefined);
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
    selectExtension(null);
    if (t.source === "workflow" && !t.deviceId) {
      void call<import("@/lib/workflows").WorkflowRun>("workflow_run", {
        id: t.id,
      })
        .then((run) => {
          const released = localSnapshot.temporaryProjects?.some(
            (p) =>
              p.path === t.project &&
              ["cleaned", "cleaning"].includes(p.status),
          );
          workflows.open(
            { ...run.definition, id: "", revision: 0 },
            released ? "" : t.project,
          );
          navigate("workflow-edit");
        })
        .catch((error) => toast.error(String(error)));
      return;
    }
    if (
      !t.deviceId &&
      localSnapshot.temporaryProjects?.some(
        (p) =>
          p.path === t.project && ["cleaned", "cleaning"].includes(p.status),
      )
    ) {
      beginNewTask(t.project, t);
      return;
    }
    fileWorkspace.select(null);
    setDraft(undefined);
    setReturnToDraft(null);
    setDetailTrail([]);
    setSeed(t);
    setSelected(null);
    if (["supervisor", "workflow"].includes(t.source)) {
      editWorkflow({
        ...newWorkflow(localSnapshot.agents),
        name: t.title,
        goal: t.prompt,
      });
    } else setPage("new");
  }
  // An open task owns its breadcrumb and sidebar, independent of the page beneath it.
  const visiblePage: Page = activeExtension
    ? "plugins"
    : activeFile
      ? activeFile.instruction
        ? "instructions"
        : activeFile.skill
          ? "integrations"
          : "tasks"
      : task
        ? task.archived
          ? "archived"
          : task.source === "history"
            ? "history"
            : "tasks"
        : page;
  const visibleProject = activeFile?.instruction
    ? activeFile.instruction.scope.project || "all"
    : activeFile?.skill
      ? activeFile.skill.scope.project || "all"
      : activeFile?.project || task?.project || project;
  async function onTasksDeleted(ids: string[], deletedProjects: string[]) {
    if (deletedProjects.includes(project)) setProject("all");
    setOpened((current) => current.filter((id) => !ids.includes(id)));
    setSelected((current) =>
      current && ids.includes(current) ? null : current,
    );
    setDetailTrail((current) => current.filter((id) => !ids.includes(id)));
    await refreshOrganization();
  }
  useBackgroundUpdateCheck();
  const workspaceReturn = useRef<PageLocation>({
    kind: "page",
    page: "tasks",
    project: "all",
  });
  useLayoutEffect(() => {
    if (sectionFor(page) === "workspace")
      workspaceReturn.current = { kind: "page", page, project };
  }, [page, project]);
  const recentProjects = useRecentProjects(
    snapshot.projects,
    localSnapshot.tasks,
    sectionFor(visiblePage) === "workspace" && !task?.deviceId
      ? visibleProject
      : "all",
    activeFile?.id || task?.id || visibleProject,
  );
  const temporaryProject =
    !task?.deviceId && sectionFor(visiblePage) === "workspace"
      ? snapshot.temporaryProjects?.find(
          (p) =>
            p.status !== "kept" &&
            (visibleProject === p.path ||
              visibleProject
                .replace(/\\/g, "/")
                .startsWith(p.path.replace(/\\/g, "/") + "/")),
        )
      : undefined;
  const title =
    visiblePage === "todos-edit" && todos.editor
      ? todos.editor.input.id
        ? "编辑计划"
        : todos.editor.input.parentId
          ? "添加子计划"
          : "添加计划"
      : pageNames[visiblePage];
  const terminalProject = desktop && !task?.deviceId && sectionFor(visiblePage) === "workspace" && visibleProject !== "all" ? visibleProject : null;
  useNativeMenu(handleMenuAction, {
    canSave:
      !!activeFile &&
      activeFile.mode === "edit" &&
      !activeFile.loading &&
      !activeFile.saving &&
      !fileWorkspace.closing,
    canClose:
      !!(activeExtension || selectedFileId || selected || pinnedProject) &&
      !fileWorkspace.closing,
    canBack: navigationHistory.canGoBack && !fileWorkspace.closing,
    context: {
      canCloseProject: !!pinnedProject && !fileWorkspace.closing,
      hasTask: location.kind === "task",
      hasArtifacts: location.kind === "task" && !task?.deviceId && !task?.subagentId,
      hasProcesses: location.kind === "task" && !task?.deviceId,
      hasProjectTerminal: !!terminalProject,
      sidebarVisible: sidebar,
      terminalVisible: !!terminalProject && projectTerminalOpen,
    },
  });
  const closingFile = fileWorkspace.files.find(
    (file) => file.id === fileWorkspace.closing,
  );
  return (
    <OrganizationContext.Provider value={organization}>
      <ImageEditorContext.Provider value={fileWorkspace.openInEditor}>
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
            <WindowTitlebar />
            <AnimatePresence>
              {draggingProject && (
                <motion.div
                  role="status"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  className="pointer-events-none fixed inset-3 z-[80] flex items-center justify-center rounded-xl border-2 border-dashed border-border bg-background/90 text-sm font-medium"
                >
                  松开以在此文件夹新建任务
                </motion.div>
              )}
            </AnimatePresence>
            <div className="flex min-h-0 flex-1">
              <WorkspaceNavigation
                extensions={extensions.items}
                activeExtensionId={activeExtension?.id}
                onOpenExtension={openExtension}
                page={visiblePage}
                todoReturnPage={todos.editor?.returnPage}
                project={visibleProject}
                snapshot={{
                  ...snapshot,
                  projects: [...recentProjects].sort(
                    (a, b) =>
                      Number(!!organization.marks[projectMarkKey(b)]?.pinned) -
                      Number(!!organization.marks[projectMarkKey(a)]?.pinned),
                  ),
                }}
                sidebar={sidebar}
                onWorkspace={() =>
                  activateLocation(workspaceReturn.current, undefined, false)
                }
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
                        if (!imageFile(path) || mode === "diff") selectExtension(null);
                        void fileWorkspace.open(p, path, mode, originalPath);
                      }
                }
                onProject={setProject}
                onNewProject={(path) => beginNewTask(path)}
                onConfigureProject={configureProject}
                onAddProject={() => void addProject()}
                onSearch={() => setSearchOpen(true)}
                onExpand={() => setSidebar(true)}
              />
              <main
                onPointerDownCapture={() => setStartupResolved(true)}
                onKeyDownCapture={() => setStartupResolved(true)}
                tabIndex={-1}
                className="flex min-w-0 flex-1 flex-col outline-none"
              >
                <header
                  aria-label="页面导航栏"
                  className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 bg-card px-4 py-1.5"
                >
                  <motion.div
                    initial={false}
                    animate={{
                      width: navigationHistory.canGoBack ? 32 : 0,
                      opacity: navigationHistory.canGoBack ? 1 : 0,
                      marginRight: navigationHistory.canGoBack ? 0 : -8,
                    }}
                    transition={{ duration: 0.18 }}
                    aria-hidden={!navigationHistory.canGoBack}
                    inert={!navigationHistory.canGoBack}
                    className="shrink-0 overflow-hidden"
                  >
                    <IconButton
                      label="返回上一页"
                      tooltipSide="bottom"
                      disabled={
                        !navigationHistory.canGoBack || !!fileWorkspace.closing
                      }
                      tabIndex={navigationHistory.canGoBack ? 0 : -1}
                      onClick={goBack}
                    >
                      <ArrowLeft />
                    </IconButton>
                  </motion.div>
                  <IconButton
                    label={sidebar ? "收起侧边栏" : "展开侧边栏"}
                    onClick={() => setSidebar(!sidebar)}
                  >
                    {sidebar ? <PanelLeftClose /> : <PanelLeftOpen />}
                  </IconButton>
                  <nav
                    aria-label="面包屑"
                    className="flex min-w-0 flex-1 items-center gap-2 text-xs"
                  >
                    <span className="shrink-0 text-muted-foreground">
                      {
                        sections.find((s) => s.id === sectionFor(visiblePage))
                          ?.name
                      }
                    </span>
                    <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                    {activeExtension ? (
                      <span
                        aria-current="page"
                        className="truncate font-medium"
                      >
                        {activeExtension.title}
                      </span>
                    ) : activeFile ? (
                      <>
                        <button
                          className="max-w-36 truncate text-muted-foreground hover:text-foreground"
                          title={activeFile.project}
                          onClick={() => {
                            if (activeFile.instruction) {
                              setInstructionContext({
                                kind: activeFile.instruction.scope.kind,
                                project:
                                  activeFile.instruction.scope.project ||
                                  "user",
                              });
                              navigate("instructions");
                            } else if (activeFile.skill) {
                              setIntegrationContext({
                                kind: activeFile.skill.scope.kind,
                                project:
                                  activeFile.skill.scope.project || "user",
                                tab: "skills",
                              });
                              navigate("integrations");
                            } else {
                              setProject(activeFile.project);
                              navigate("tasks");
                            }
                          }}
                        >
                          {activeFile.instruction
                            ? "指令文件"
                            : activeFile.skill
                              ? "MCP 与 Skills"
                              : projectName(activeFile.project)}
                        </button>
                        <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                        <span
                          aria-current="page"
                          className="truncate font-medium"
                          title={
                            activeFile.skill
                              ? `${activeFile.skill.name} / ${activeFile.path}`
                              : activeFile.path
                          }
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
                        <h1
                          aria-current="page"
                          className="truncate text-xs font-medium"
                          title={task.title}
                        >
                          {task.title}
                        </h1>
                      </>
                    ) : (
                      <>
                        <span
                          aria-current={
                            project === "all" ||
                            !["tasks", "history", "archived", "stats"].includes(
                              page,
                            )
                              ? "page"
                              : undefined
                          }
                          className="truncate font-medium"
                        >
                          {title}
                        </span>
                        {project !== "all" &&
                          ["tasks", "history", "archived", "stats"].includes(
                            page,
                          ) && (
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
                  {temporaryProject && !temporaryProject.ephemeral && (
                    <TemporaryProjectMenu
                      key={temporaryProject.id}
                      project={temporaryProject}
                      onChanged={() => refresh()}
                      onCleanup={async () => {
                        const path = temporaryProject.path.replace(/\\/g, "/");
                        if (
                          fileWorkspace.files.some((f) => {
                            const p = f.project.replace(/\\/g, "/");
                            return p === path || p.startsWith(path + "/");
                          })
                        )
                          throw new Error(
                            "请先关闭此项目的文件标签，再清理临时文件。",
                          );
                        await call("cleanup_temporary_project", {
                          id: temporaryProject.id,
                        });
                        await refresh();
                      }}
                    />
                  )}
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
                      {Object.entries(pageNames)
                        .filter(
                          ([id]) =>
                            !["todos-edit", "claude-api-edit"].includes(id),
                        )
                        .map(([id, name]) => (
                          <DropdownMenuItem
                            key={id}
                            onSelect={() => navigate(id as Page)}
                          >
                            {name}
                          </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <div
                    ref={setTaskToolbarTarget}
                    className={cn(
                      "ml-auto max-w-full shrink-0",
                      (!task || activeFile || activeExtension) && "hidden",
                    )}
                  />
                  {!desktop && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] font-normal"
                    >
                      演示数据 · 不连接本机
                    </Badge>
                  )}
                  {terminalProject && <IconButton label={projectTerminalOpen ? "收起项目终端" : "打开项目终端"} onClick={() => setProjectTerminalOpen((open) => !open)}><SquareTerminal /></IconButton>}
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
                <ProjectTerminal project={terminalProject} open={projectTerminalOpen} onClose={() => setProjectTerminalOpen(false)}>
                <EditorWorkspace
                  layout={editorLayout.layout}
                  onSelect={selectEditor}
                  onMove={moveEditor}
                  onMerge={(group) => {
                    const target = editorLayout.groups.find(
                      (g) => g.id === group,
                    );
                    editorLayout.merge(group);
                    if (target) selectEditor(target.active);
                  }}
                  tabs={{
                    views: extensions.tabs,
                    onCloseView: closeExtension,
                    pageTab: {
                      title: pinnedProject
                        ? projectName(pinnedPage.project)
                        : pageNames[pinnedPage.page],
                      onClose: pinnedProject ? exitProject : undefined,
                      onSelect: () => selectEditor("page"),
                    },
                    tasks: opened
                      .map((id) => snapshot.tasks.find((t) => t.id === id))
                      .filter((t): t is Task => !!t),
                    selected,
                    files: fileWorkspace.files,
                    onCloseFile: closeFile,
                    onSelect: (id) => selectEditor(`task:${id}`),
                    onClose: closeTab,
                    onCloseMany: (tabs) => void closeMany(tabs),
                    onNew: () => navigate("new"),
                  }}
                >
                  <Suspense fallback={<Loading />}>
                    {extensions.tabs.map((openView) => (
                      <EditorPane
                        key={openView.id}
                        tabKey={`extension:${openView.id}`}
                      >
                        {editorLayout.visible(`extension:${openView.id}`) && (
                          <div
                            id={`extension-panel-${openView.id}`}
                            role="tabpanel"
                            aria-labelledby={`extension-tab-${openView.id}`}
                            className="h-full min-h-0"
                          >
                            <PaneBoundary key={openView.id} label="插件页面">
                              <ExtensionViewPage
                                key={openView.id}
                                plugin={extensions.items.find(
                                  (p) => p.manifest.id === openView.pluginId,
                                )}
                                tab={openView}
                                readValues={() =>
                                  extensions.getValues(openView.id)
                                }
                                onValues={(values) =>
                                  extensions.setValues(openView.id, values)
                                }
                                context={openView.context}
                                tasks={snapshot.tasks}
                                onOpen={(viewId) =>
                                  openExtension(openView.pluginId, viewId)
                                }
                                onDraft={(value) => {
                                  if (draft?.prompt.trim())
                                    throw new Error(
                                      "已有未提交的任务草稿，请先处理后再填写。",
                                    );
                                  beginNewTask(
                                    openView.context.project || "all",
                                  );
                                  setDraft((next) =>
                                    next ? { ...next, ...value } : next,
                                  );
                                }}
                                onManage={() => {
                                  setManagedPluginId(openView.pluginId);
                                  navigate("plugins");
                                }}
                              />
                            </PaneBoundary>
                          </div>
                        )}
                      </EditorPane>
                    ))}
                    {fileWorkspace.files.map((openFile) => (
                      <EditorPane
                        key={openFile.id}
                        tabKey={`file:${openFile.id}`}
                      >
                        {editorLayout.visible(`file:${openFile.id}`) && (
                          <div
                            id={`file-panel-${openFile.id}`}
                            role="tabpanel"
                            aria-labelledby={`file-tab-${openFile.id}`}
                            className="h-full min-h-0"
                          >
                            <PaneBoundary key={openFile.id} label="文件编辑器">
                              <Suspense fallback={<Loading />}>
                                <FileEditor
                                  file={openFile}
                                  onLocationRevealed={() =>
                                    fileWorkspace.update(
                                      openFile.id,
                                      (file) => ({
                                        ...file,
                                        location: undefined,
                                      }),
                                    )
                                  }
                                  onSkillWriting={(patch) =>
                                    fileWorkspace.update(openFile.id, (f) => ({
                                      ...f,
                                      skillWriting: {
                                        ...f.skillWriting,
                                        ...patch,
                                      },
                                    }))
                                  }
                                  onLlmSettings={() => navigate("settings-llm")}
                                  onChange={(content) =>
                                    fileWorkspace.update(openFile.id, (f) => ({
                                      ...f,
                                      content,
                                    }))
                                  }
                                  onSave={() =>
                                    void fileWorkspace.save(openFile.id)
                                  }
                                  onReload={() =>
                                    void fileWorkspace.reload(openFile.id)
                                  }
                                  onOpen={(p, path, mode) =>
                                    void fileWorkspace.open(p, path, mode)
                                  }
                                  onResolve={(useDisk) =>
                                    fileWorkspace.update(openFile.id, (f) =>
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
                      </EditorPane>
                    ))}
                    {!loading &&
                      opened
                        .map((id) => snapshot.tasks.find((t) => t.id === id))
                        .filter((t): t is Task => !!t)
                        .map((openTask) => (
                          <EditorPane
                            key={openTask.id}
                            tabKey={`task:${openTask.id}`}
                          >
                            <div
                              id={`task-panel-${openTask.id}`}
                              role="tabpanel"
                              aria-labelledby={`task-tab-${openTask.id}`}
                              className="h-full min-h-0"
                            >
                              <DetailPage
                                task={openTask}
                                toolbarTarget={
                                  currentEditorKey === `task:${openTask.id}`
                                    ? taskToolbarTarget
                                    : null
                                }
                                ephemeral={snapshot.temporaryProjects?.some(
                                  (p) =>
                                    p.ephemeral && p.path === openTask.project,
                                )}
                                projectUnavailable={
                                  !openTask.deviceId &&
                                  snapshot.temporaryProjects?.some(
                                    (p) =>
                                      ["cleaned", "cleaning"].includes(
                                        p.status,
                                      ) &&
                                      (p.path === openTask.project ||
                                        openTask.project
                                          .replace(/\\/g, "/")
                                          .startsWith(
                                            p.path.replace(/\\/g, "/") + "/",
                                          )),
                                  )
                                }
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
                                  openTask.deviceId
                                    ? []
                                    : snapshot.providers || []
                                }
                                focused={
                                  currentEditorKey === `task:${openTask.id}`
                                }
                                active={editorLayout.visible(
                                  `task:${openTask.id}`,
                                )}
                                onBack={() => {
                                  const previous = detailTrail.at(-1);
                                  setSelected(previous || null);
                                  setDetailTrail((trail) => trail.slice(0, -1));
                                }}
                                hasUnsavedFiles={fileWorkspace.files.some(
                                  (file) =>
                                    file.project === openTask.project &&
                                    dirtyFile(file),
                                )}
                                onEdited={(next, replace) => {
                                  setSnapshot((snapshot) => ({
                                    ...snapshot,
                                    tasks: [
                                      next,
                                      ...snapshot.tasks.filter(
                                        (task) => task.id !== next.id,
                                      ),
                                    ],
                                  }));
                                  open(next);
                                  if (replace) {
                                    setOpened((ids) =>
                                      ids
                                        .filter((id) => id !== next.id)
                                        .map((id) =>
                                          id === openTask.id ? next.id : id,
                                        ),
                                    );
                                    setDetailTrail([]);
                                    editorLayout.replace(
                                      `task:${openTask.id}`,
                                      `task:${next.id}`,
                                    );
                                  }
                                }}
                                onOpen={open}
                                onOpenFile={
                                  openTask.deviceId
                                    ? undefined
                                    : (
                                        project,
                                        path,
                                        mode,
                                        originalPath,
                                        location,
                                      ) =>
                                        void fileWorkspace.open(
                                          project,
                                          path,
                                          mode,
                                          originalPath,
                                          undefined,
                                          undefined,
                                          location,
                                        )
                                }
                                onChanged={() =>
                                  openTask.deviceId
                                    ? remote.refresh()
                                    : refresh()
                                }
                                onWorkflowCopy={(definition) => {
                                  workflows.open(definition, openTask.project);
                                  navigate("workflow-edit");
                                }}
                                onRetry={retry}
                              />
                            </div>
                          </EditorPane>
                        ))}
                    <EditorPane
                      tabKey="page"
                      scroll={page !== "workflow-edit" && page !== "plugins"}
                    >
                      <div
                        id="page-panel"
                        role="tabpanel"
                        aria-labelledby="page-tab"
                        className="h-full min-h-0"
                      >
                        {loading && <Loading />}
                        {!loading && editorLayout.visible("page") && (
                          <div
                            key={page}
                            className={
                              page === "workflow-edit" ||
                              page === "plugins" ||
                              page === "new"
                                ? "h-full min-h-0"
                                : "min-h-full"
                            }
                          >
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
                                  localStorage.setItem(
                                    "oiagent-onboarded",
                                    "true",
                                  );
                                  navigate(startupHasTasks ? "tasks" : "new");
                                }}
                              />
                            )}
                            {(page === "tasks" ||
                              page === "history" ||
                              page === "archived") && (
                              <TasksPage
                                key={page}
                                snapshot={snapshot}
                                project={project}
                                mode={page}
                                openProjects={fileWorkspace.files.map(
                                  (file) => file.project,
                                )}
                                onProject={setProject}
                                onOpen={open}
                                onNew={() => navigate("new")}
                                onHistory={() => navigate("history")}
                                onStats={() => navigate("stats")}
                                onConfigureProject={configureProject}
                                onDeleted={onTasksDeleted}
                                onRefresh={refreshOrganization}
                              />
                            )}
                            {(page === "todos" ||
                              page === "todos-completed") && (
                              <TodosPage
                                state={todos}
                                completed={page === "todos-completed"}
                                onEdit={editTodo}
                                onCreateTask={createTodoTask}
                              />
                            )}
                            {page === "todos-edit" && todos.editor && (
                              <TodoEditorPage
                                key={todos.editor.sessionId}
                                state={todos}
                                projects={localSnapshot.projects}
                                onBack={() =>
                                  navigate(todos.editor?.returnPage || "todos")
                                }
                                onDone={finishTodoEditor}
                              />
                            )}
                            {page === "stats" && (
                              <StatsPage
                                snapshot={snapshot}
                                project={project}
                              />
                            )}{" "}
                            {page === "supervisor" && (
                              <WorkflowsPage
                                state={workflows}
                                snapshot={localSnapshot}
                                openProjects={fileWorkspace.files.map(
                                  (file) => file.project,
                                )}
                                onDeleted={onTasksDeleted}
                                onRefresh={refreshOrganization}
                                onEdit={editWorkflow}
                                onOpen={open}
                              />
                            )}
                            {page === "workflow-edit" && workflows.editor && (
                              <WorkflowEditorPage
                                key={workflows.editor.sessionId}
                                editor={workflows.editor}
                                snapshot={localSnapshot}
                                onChange={workflows.update}
                                onSaved={workflows.refresh}
                                onBack={() => navigate("supervisor")}
                                onCreated={created}
                                onSettings={() => {
                                  setReturnToDraft("workflow-edit");
                                  setPage("settings-llm");
                                }}
                              />
                            )}
                            {page === "new" && (
                              <NewTaskPage
                                key={`${page}-${seed?.id || "new"}-${newTaskKey}`}
                                snapshot={snapshot}
                                project={project}
                                seed={seed}
                                onCreated={created}
                                draft={draft}
                                onDraftChange={setDraft}
                                onSettings={(value) =>
                                  leaveDraft("settings-llm", value)
                                }
                                onAgents={(value) =>
                                  leaveDraft("agents", value)
                                }
                              />
                            )}{" "}
                            {page === "plugins" && (
                              <PluginsPage
                                initialSelection={managedPluginId}
                                items={extensions.items}
                                warnings={extensions.warnings}
                                error={extensions.error}
                                onRefresh={extensions.refresh}
                                onOpen={openExtension}
                                onAgents={() => navigate("agents")}
                              />
                            )}
                            {page === "agents" && (
                              <AgentsPage
                                key={page}
                                snapshot={snapshot}
                                onRefresh={refresh}
                                onClaudeApi={() => setPage("claude-api")}
                                onInstructions={(kind) => {
                                  setInstructionContext({
                                    kind,
                                    project: "user",
                                  });
                                  setPage("instructions");
                                }}
                                onIntegrations={(kind) => {
                                  setIntegrationKind(kind);
                                  setIntegrationContext(undefined);
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
                            {page === "instructions" && (
                              <InstructionsPage
                                snapshot={snapshot}
                                context={instructionContext}
                                onContext={setInstructionContext}
                                onOpen={(scope, file) => {
                                  setSelected(null);
                                  const path = file.path.replace(/\\/g, "/");
                                  const name = path.slice(
                                    path.lastIndexOf("/") + 1,
                                  );
                                  void fileWorkspace.open(
                                    path.slice(0, path.lastIndexOf("/")),
                                    name,
                                    "edit",
                                    undefined,
                                    undefined,
                                    { scope, id: file.id },
                                  );
                                }}
                              />
                            )}
                            {page === "integrations" && (
                              <IntegrationsPage
                                snapshot={snapshot}
                                initialKind={integrationKind}
                                context={integrationContext}
                                onContextChange={setIntegrationContext}
                                onEditSkill={(scope, skill) => {
                                  setSelected(null);
                                  const path = skill.path.replace(/\\/g, "/");
                                  void fileWorkspace.open(
                                    path.slice(0, path.lastIndexOf("/")),
                                    "SKILL.md",
                                    "edit",
                                    undefined,
                                    { scope, id: skill.id, name: skill.name },
                                  );
                                }}
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
                                  onEdit={(profile) => {
                                    setProviderEdit(providerDraft(profile));
                                    setPage("claude-api-edit");
                                  }}
                                />
                              </div>
                            )}
                            {page === "claude-api-edit" && providerEdit && (
                              <ProviderEditor
                                key={providerEdit.sessionId}
                                draft={providerEdit}
                                onChange={setProviderEdit}
                                onMigrated={() => refresh()}
                                onBack={() => setPage("claude-api")}
                                onSaved={async () => {
                                  try {
                                    await refresh();
                                  } catch {
                                    toast.error(
                                      "配置已保存，列表刷新失败，请稍后刷新",
                                    );
                                  }
                                  if (
                                    providerEditRef.current?.sessionId ===
                                    providerEdit.sessionId
                                  ) {
                                    setProviderEdit(null);
                                    setPage((current) =>
                                      current === "claude-api-edit"
                                        ? "claude-api"
                                        : current,
                                    );
                                  }
                                }}
                              />
                            )}
                            {page === "settings-lan" && (
                              <LanSettingsPage
                                snapshot={localSnapshot}
                                devices={remote.devices}
                                onChanged={remote.refresh}
                              />
                            )}
                            {isSettingsPage(page) &&
                              page !== "settings-lan" && (
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
                                      {returnToDraft === "workflow-edit"
                                        ? "返回工作流"
                                        : "返回新建任务"}
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
                      </div>
                    </EditorPane>
                  </Suspense>
                </EditorWorkspace>
                </ProjectTerminal>
              </main>
            </div>
            <WorkspaceStatusBar
              activeCount={active.length}
              availableAgents={
                localSnapshot.agents.filter((agent) => agent.available).length
              }
              dataDir={snapshot.dataDir}
              refreshing={refreshing}
              autoRefresh={autoRefresh}
              warnings={snapshot.warnings}
              error={error}
              onTasks={() => {
                setProject("all");
                navigate("tasks");
              }}
              onNavigate={navigate}
              onRefresh={() =>
                void refresh(true).catch((e) => toast.error(String(e)))
              }
            />
          </div>
          <Dialog
            open={!!pendingTodo}
            onOpenChange={(open) => {
              if (!open) setPendingTodo(null);
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>已有未提交的任务草稿</DialogTitle>
                <DialogDescription>
                  替换后会使用计划的内容和项目目录。追加只添加计划内容，保留草稿的项目和
                  Agent 设置。
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPendingTodo(null)}>
                  取消
                </Button>
                {draft?.mode === "agent" && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (pendingTodo) fillTodoTask(pendingTodo, true);
                    }}
                  >
                    追加到草稿
                  </Button>
                )}
                <Button
                  onClick={() => {
                    if (pendingTodo) fillTodoTask(pendingTodo);
                  }}
                >
                  替换草稿
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
                  placeholder="搜索任务、项目或插件命令…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="max-h-96 overflow-auto px-2 pb-3">
                {extensions.items
                  .filter((p) => p.enabled)
                  .flatMap((p) =>
                    p.manifest.contributes.commands
                      .filter((c) =>
                        `${c.title} ${p.manifest.name}`
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                      )
                      .map((c) => (
                        <button
                          key={`${p.manifest.id}:${c.id}`}
                          className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-muted"
                          onClick={() => openExtension(p.manifest.id, c.view)}
                        >
                          <ExtensionIcon
                            name={
                              p.manifest.contributes.views.find(
                                (v) => v.id === c.view,
                              )?.icon
                            }
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm">{c.title}</span>
                            <span className="text-xs text-muted-foreground">
                              {p.manifest.name} · 插件命令
                            </span>
                          </span>
                        </button>
                      )),
                  )}
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
                {!filterTasks(snapshot.tasks, query).length &&
                  !extensions.items.some(
                    (p) =>
                      p.enabled &&
                      p.manifest.contributes.commands.some((c) =>
                        `${c.title} ${p.manifest.name}`
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                      ),
                  ) && (
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
                    if (fileWorkspace.closing)
                      discardFile(fileWorkspace.closing);
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
          {fileWorkspace.imagePreview && <ProjectImageDialog
            key={`${fileWorkspace.imagePreview.project}:${fileWorkspace.imagePreview.path}`}
            {...fileWorkspace.imagePreview}
            onClose={() => fileWorkspace.previewImage(null)}
          />}
          <CloseApplication
            dirtyFiles={fileWorkspace.files.filter(dirtyFile).length}
          />
          <Toaster position="bottom-right" richColors />
        </TooltipProvider>
      </MotionConfig>
      </ImageEditorContext.Provider>
    </OrganizationContext.Provider>
  );
}
