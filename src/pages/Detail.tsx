import { EditMessage } from "@/components/workspace/EditMessage";
import { useConversationNavigation } from "@/hooks/useConversationNavigation";
import { ConversationRail } from "@/components/workspace/ConversationRail";
import { useSessionServices } from "@/hooks/useSessionServices";
import { useTaskArtifacts } from "@/hooks/useTaskArtifacts";
import { newerTask } from "@/lib/taskState";
import {
  useActivityNotices,
  type ActivityKind,
} from "@/hooks/useActivityNotices";
import { sessionCommands } from "@/lib/sessionActivity";
import {
  SessionProcesses,
  SessionServices,
} from "@/components/workspace/SessionActivity";
import { Files, Server } from "lucide-react";
import { ModelPicker } from "@/components/workspace/ModelPicker";
import {
  readModelOptions,
  emptyModelOptions,
  supportsModelPicker,
} from "@/lib/modelOptions";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { SlashCommands } from "@/components/workspace/SlashCommands";
import { useTaskCommands } from "@/hooks/useTaskCommands";
import { isNewChatCommand, slashCommand } from "@/lib/slashCommands";
import { WorkflowArtifacts } from "@/components/workspace/WorkflowArtifacts";
import { ApprovalCard } from "@/components/workspace/ApprovalCard";
import type { Approval } from "@/lib/approvals";
import { usePageTransition } from "@/hooks/usePageTransition";
import { WorkflowRunPanel } from "@/components/workspace/WorkflowRun";
import type { WorkflowDefinition, WorkflowRun } from "@/lib/workflows";
import { Plus } from "lucide-react";
import type { OpenProjectFile } from "@/lib/editFiles";
import { normalizePermission } from "@/lib/permissions";
import { PaneBoundary } from "@/components/workspace/PaneBoundary";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowDown,
  Archive,
  Download,
  Info,
  Copy,
  Workflow,
  Terminal,
  Square,
  MoreHorizontal,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  StatusBadge,
  AgentIcon,
  IconButton,
  Choice,
} from "@/components/workspace/shared";
const TerminalView = lazy(() =>
  import("@/components/workspace/TerminalView").then((m) => ({
    default: m.TerminalView,
  })),
);
import { call, desktop, exportText } from "@/lib/api";
import {
  agentNames,
  projectName,
  isActive,
  type Task,
  type Detail,
  type Agent,
  type ProviderProfile,
} from "@/lib/types";
import { Transcript, SubagentCard } from "@/components/workspace/Transcript";
import { ConversationComposer } from "@/components/workspace/ConversationComposer";
import { buildTranscript } from "@/lib/transcript";
export function DetailPage({
  task,
  tasks,
  onBack,
  onOpen,
  onOpenFile,
  onChanged,
  onRetry,
  onNewTask,
  agents,
  profiles,
  onWorkflowCopy,
  active = true,
  projectUnavailable = false,
  ephemeral = false,
  toolbarTarget,
  hasUnsavedFiles = false,
  onEdited,
}: {
  hasUnsavedFiles?: boolean;
  onEdited?: (task: Task, replace: boolean) => void;
  task: Task;
  tasks: Task[];
  onBack: () => void;
  onOpen: (t: Task) => void;
  onOpenFile?: OpenProjectFile;
  onChanged: () => Promise<void>;
  onRetry: (t: Task) => void;
  onNewTask?: () => void;
  agents: Agent[];
  profiles: ProviderProfile[];
  onWorkflowCopy?: (definition: WorkflowDefinition) => void;
  active?: boolean;
  projectUnavailable?: boolean;
  ephemeral?: boolean;
  toolbarTarget?: HTMLElement | null;
}) {
  const localWorkflow = task.source === "workflow" && !task.deviceId;
  const [editing, setEditing] = useState<{
    detail: Detail;
    index: number;
  } | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [pendingApprovals, setApprovals] = useState<Approval[]>([]);
  const [approvalError, setApprovalError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [tab, setTab] = useState("info");
  const [info, setInfo] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [titleSource, setTitleSource] = useState(task.title);
  const [permission, setPermission] = useState(
    normalizePermission(task.agentKind, task.permission),
  );
  const [nextAgent, setNextAgent] = useState(task.agentId);
  const [nextProvider, setNextProvider] = useState(task.providerId || "local");
  const [nextModel, setNextModel] = useState(
    task.model === "默认模型" ? "" : task.model,
  );
  const [nextModelOptions, setNextModelOptions] = useState(() =>
    readModelOptions(task.agentKind, task.extraArgs),
  );
  const [view, setView] = useState(
    task.source === "workflow" && !task.deviceId
      ? "workflow"
      : task.source === "terminal"
        ? "terminal"
        : "chat",
  );
  const viewTransition = usePageTransition(view);
  const [terminalError, setTerminalError] = useState("");
  const [connected, setConnected] = useState<Task | null>(null);
  const current = { ...task, ...newerTask(task, detail?.task) };
  if (titleSource !== current.title) {
    setTitleSource(current.title);
    if (titleDraft === titleSource) setTitleDraft(current.title);
  }

  const approvals = ["running", "waiting"].includes(current.status)
    ? pendingApprovals
    : [];
  const children = tasks.filter(
    (t) =>
      t.source !== "terminal" &&
      (t.parentId === task.id ||
        (!!task.sessionId &&
          t.parentId === `history-${task.agentKind}-${task.sessionId}`)),
  );
  const parent = tasks.find((t) => t.id === task.parentId);
  const terminalTask =
    task.source === "terminal"
      ? current
      : (() => {
          if (!current.terminalId) return null;
          const snapshot = tasks.find((t) => t.id === current.terminalId);
          const cached =
            connected?.id === current.terminalId ? connected : null;
          return snapshot ? newerTask(snapshot, cached || undefined) : cached;
        })();
  const terminalRunning =
    !!terminalTask && ["running", "stopping"].includes(terminalTask.status);
  const selectedAgent = agents.find((a) => a.id === nextAgent);

  useEffect(() => {
    if (task.deviceId && (!active || task.deviceOnline === false)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const approvalLoad =
          !task.deviceId &&
          active &&
          ["running", "waiting"].includes(current.status)
            ? call<Approval[]>("task_approvals", { id: task.id })
            : Promise.resolve([] as Approval[]);
        const detailLoad = call<Detail>("get_detail", {
          id:
            task.source === "terminal" && task.parentId
              ? task.parentId
              : task.id,
        });
        const [loaded, pending] = await Promise.allSettled([
          detailLoad,
          approvalLoad,
        ]);
        if (!stopped) {
          if (pending.status === "fulfilled") {
            setApprovals(pending.value);
            setApprovalError("");
          } else {
            setApprovals([]);
            setApprovalError(String(pending.reason));
          }
          if (loaded.status === "fulfilled") {
            setDetail((previous) =>
              previous &&
              previous.task !== loaded.value.task &&
              newerTask(previous.task, loaded.value.task) === previous.task
                ? previous
                : loaded.value,
            );
            setError("");
          } else setError(String(loaded.reason));
        }
      } catch (e) {
        if (!stopped) setError(String(e));
      } finally {
        if (!stopped)
          timer = setTimeout(
            load,
            active &&
              (terminalRunning ||
                ["running", "waiting", "queued", "stopping"].includes(
                  current.status,
                ))
              ? task.deviceId
                ? 2000
                : 1000
              : 10000,
          );
      }
    }
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [
    task.id,
    task.deviceId,
    task.deviceOnline,
    task.parentId,
    task.source,
    current.status,
    active,
    view,
    terminalRunning,
  ]);
  async function connectTerminal() {
    setBusy(true);
    setTerminalError("");
    try {
      const terminal = await call<Task>("connect_agent_terminal", {
        id: task.id,
        stopCurrent: isActive(current) && current.status !== "stopping",
      });
      setConnected(terminal);
      await onChanged();
    } catch (e) {
      setTerminalError(String(e));
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }
  const timeline = useMemo(
    () => buildTranscript(detail?.messages || []),
    [detail?.messages],
  );
  const conversation = useConversationNavigation(
    timeline,
    active && view === "chat",
  );

  const taskActive = isActive(current);
  const commands = useMemo(
    () => sessionCommands(timeline, taskActive),
    [timeline, taskActive],
  );
  const processes = useMemo(
    () => commands.filter((command) => command.state === "running"),
    [commands],
  );
  const services = useSessionServices(
    commands,
    desktop && active && !task.deviceId,
    task.id,
  );
  const hasArtifacts = !task.deviceId && !task.subagentId;
  const artifactCatalog = useTaskArtifacts(
    localWorkflow ? "workflow" : "task",
    task.id,
    active && hasArtifacts,
    current.updatedAt,
    taskActive,
  );
  const unread = useActivityNotices(
    task.id,
    {
      processes: [
        ...processes.map((command) => `command:${command.id}`),
        ...services.map(
          (service) => `service:${service.id}:${service.commandId}`,
        ),
      ],
      artifacts:
        artifactCatalog.data?.files.map(
          (file) => `${file.path}:${file.size}`,
        ) || [],
    },
    active && info ? tab : undefined,
  );
  const resources: {
    id: ActivityKind;
    label: string;
    icon: typeof Terminal;
    count?: number;
    error?: string;
  }[] = [
    {
      id: "processes",
      label: "进程和服务",
      icon: Server,
      count: detail ? processes.length + services.length : undefined,
    },
    ...(hasArtifacts
      ? [
          {
            id: "artifacts" as const,
            label: "产物",
            icon: Files,
            count: artifactCatalog.data?.files.length,
            error: artifactCatalog.error,
          },
        ]
      : []),
  ];
  async function action(command: string, args: Record<string, unknown>) {
    setBusy(true);
    try {
      const updated = await call<Task | undefined>(command, args);
      if (updated?.source === "terminal") {
        setConnected((previous) =>
          previous ? newerTask(previous, updated) : updated,
        );
      }
      if (updated?.id === task.id) {
        setDetail((previous) => ({
          messages: previous?.messages || [],
          log: previous?.log || "",
          task: newerTask(previous?.task || task, updated),
        }));
        if (!isActive(updated)) {
          setApprovals([]);
          setApprovalError("");
        }
      }
      if (command === "run_queued_messages") {
        const loaded = await call<Detail>("get_detail", { id: task.id });
        setDetail((previous) =>
          previous &&
          previous.task !== loaded.task &&
          newerTask(previous.task, loaded.task) === previous.task
            ? previous
            : loaded,
        );
      }
      await onChanged();
      return true;
    } catch (e) {
      toast.error(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const livePermission =
    !task.deviceId &&
    nextAgent === current.agentId &&
    ["claude", "qwen", "qodercn"].includes(current.agentKind) &&
    ["running", "waiting"].includes(current.status) &&
    !terminalRunning;
  useEffect(() => {
    if (nextAgent === task.agentId) {
      // Reflect acknowledged changes, including a reply arriving after a timeout.
      // oxlint-disable-next-line react/set-state-in-effect
      setPermission(normalizePermission(task.agentKind, task.permission));
    }
  }, [task.permission, task.agentId, task.agentKind, nextAgent]);
  const sendLock = useRef(false);
  async function changePermission(value: string) {
    if (busy || permissionBusy || value === permission) return;
    if (!livePermission) {
      setPermission(value);
      if (isActive(current)) toast.info("此权限将在下轮执行时使用");
      return;
    }
    setPermissionBusy(true);
    try {
      const updated = await call<Task>("set_task_permission", {
        id: task.id,
        permission: value,
      });
      setPermission(normalizePermission(updated.agentKind, updated.permission));
      setDetail((old) =>
        old ? { ...old, task: newerTask(old.task, updated) } : old,
      );
      await onChanged();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setPermissionBusy(false);
    }
  }
  const [settingsOpen, setSettingsOpen] = useState(false);
  const discoveredCommands = useTaskCommands(
    task.id,
    nextAgent,
    active && !task.deviceId && (prompt.startsWith("/") || settingsOpen),
    task.status,
  );
  const commandCatalog =
    nextProvider === (current.providerId || "local")
      ? discoveredCommands
      : { commands: [], models: [] };
  async function applyModel(value: string) {
    if (
      !selectedAgent ||
      selectedAgent.custom ||
      ![
        "codex",
        "claude",
        "qwen",
        "qodercn",
        "gemini",
        "opencode",
        "aider",
        "goose",
      ].includes(selectedAgent.kind)
    ) {
      toast.error("此程序请在原生终端中切换模型");
      return false;
    }
    if (
      !!value.trim() &&
      !task.deviceId &&
      nextAgent === current.agentId &&
      nextProvider === (current.providerId || "local") &&
      ["running", "waiting"].includes(current.status) &&
      !terminalRunning &&
      ["claude", "qwen", "qodercn"].includes(current.agentKind)
    ) {
      setBusy(true);
      try {
        const updated = await call<Task>("set_task_model", {
          id: task.id,
          model: value,
        });
        setNextModel(updated.model);
        setDetail((old) =>
          old ? { ...old, task: newerTask(old.task, updated) } : old,
        );
        await onChanged();
        toast.success("模型已切换，下一次模型调用生效");
      } catch (e) {
        toast.error(String(e));
        return false;
      } finally {
        setBusy(false);
      }
    } else {
      setNextModel(value);
      toast.success("已设置下轮模型");
    }
    if (value !== nextModel) setNextModelOptions({ ...emptyModelOptions });
    return true;
  }
  async function send(immediate = false) {
    if (!prompt.trim() || sendLock.current || busy || permissionBusy) return;
    const command = slashCommand(prompt);
    if (command && isNewChatCommand(command.name)) {
      if (command.argument) {
        toast.error(`/${command.name} 不接受参数`);
      } else if (onNewTask) {
        setPrompt("");
        onNewTask();
      } else {
        toast.error("当前页面无法新建聊天");
      }
      return;
    }
    if (!selectedAgent?.available) {
      toast.error("请选择可用的 Agent");
      return;
    }
    if (prompt.trim() === "/") return;
    if (command?.name === "model") {
      if (!command.argument) {
        setSettingsOpen(true);
        setPrompt("");
      } else if (await applyModel(command.argument)) setPrompt("");
      return;
    }
    if (
      command &&
      (!commandCatalog.commands.some((c) => c.name === command.name) ||
        nextAgent !== current.agentId ||
        nextProvider !== (current.providerId || "local"))
    ) {
      toast.error("此命令请在对应 Agent 的原生终端中执行", {
        action: { label: "进入终端", onClick: () => setView("terminal") },
      });
      return;
    }
    const messageText = prompt;
    const previousQueue = new Set(current.queuedMessages?.map((m) => m.id));
    sendLock.current = true;
    setBusy(true);
    try {
      const accepted = await call<Task>("queue_message", {
        id: task.id,
        text: prompt,
        immediate,
        agentId: nextAgent,
        permission,
        model: nextModel,
        ...(!task.deviceId ? { modelOptions: nextModelOptions } : {}),
        providerId:
          selectedAgent?.kind === "claude" && nextProvider !== "local"
            ? nextProvider
            : null,
      });
      if (accepted?.id === task.id) {
        setDetail((previous) => ({
          messages: previous?.messages || [],
          log: previous?.log || "",
          task: newerTask(previous?.task || task, accepted),
        }));
      }
      setPrompt("");
      await onChanged();
      const updated = await call<Detail>("get_detail", { id: task.id });
      setDetail((previous) =>
        previous &&
        previous.task !== updated.task &&
        newerTask(previous.task, updated.task) === previous.task
          ? previous
          : updated,
      );
    } catch (e) {
      toast.error(String(e));
      // A failed restart may already have saved the message. Show its queue entry
      // and clear only that accepted draft so retrying cannot duplicate it.
      try {
        const updated = await call<Detail>("get_detail", { id: task.id });
        setDetail((previous) =>
          previous &&
          previous.task !== updated.task &&
          newerTask(previous.task, updated.task) === previous.task
            ? previous
            : updated,
        );
        if (
          updated.task.queuedMessages?.some(
            (m) => !previousQueue.has(m.id) && m.text === messageText,
          )
        )
          setPrompt("");
        await onChanged();
      } catch {
        /* Keep the draft if delivery cannot be confirmed. */
      }
    } finally {
      sendLock.current = false;
      setBusy(false);
    }
  }
  const canContinue =
    (!task.deviceId ||
      (task.deviceWritable !== false && task.deviceOnline !== false)) &&
    !task.subagentId &&
    !["terminal", "supervisor", "workflow"].includes(task.source) &&
    agents.some((a) => a.available) &&
    !terminalRunning;
  function openPanel(next: string) {
    setTab(next);
    setInfo(true);
  }
  const jumpToLatest = conversation.latest;
  const toolbar = (
    <div
      role="group"
      aria-label="任务操作栏"
      className="flex max-w-full flex-wrap items-center justify-end gap-1.5"
    >
      {(parent || toolbarTarget === undefined) && (
        <IconButton
          label={parent ? "返回父会话" : "返回任务列表"}
          onClick={parent ? () => onOpen(parent) : onBack}
        >
          <ArrowLeft />
        </IconButton>
      )}
      {onNewTask && !localWorkflow && (
        <IconButton label="在此项目新建任务" onClick={onNewTask}>
          <Plus />
        </IconButton>
      )}
      {!task.subagentId && !task.deviceId && (
        <Tabs value={view} onValueChange={setView}>
          <TabsList className="h-7" aria-label="任务视图">
            {localWorkflow && (
              <TabsTrigger value="workflow" className="text-xs">
                工作流
              </TabsTrigger>
            )}
            <TabsTrigger value="chat" className="text-xs">
              对话
            </TabsTrigger>
            {!localWorkflow && task.source !== "supervisor" && (
              <TabsTrigger value="terminal" className="text-xs">
                终端
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>
      )}
      {view === "terminal" &&
        terminalTask &&
        (terminalRunning ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || terminalTask.status === "stopping"}
            onClick={() => void action("stop_task", { id: terminalTask.id })}
          >
            <Square />
            {terminalTask.status === "stopping" ? "终止中" : "停止终端"}
          </Button>
        ) : (
          task.source !== "terminal" && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void connectTerminal()}
            >
              重新连接
            </Button>
          )
        ))}
      <StatusBadge
        status={current.status}
        terminal={task.source === "terminal" || !!current.terminalId}
      />
      {children.length > 0 && !localWorkflow && (
        <Button
          size="sm"
          variant="ghost"
          className="gap-1.5"
          onClick={() => openPanel("children")}
          aria-label={`子 Agent ${children.length}`}
        >
          <Workflow className="size-4" />
          <span className="hidden sm:inline">子 Agent</span>
          <span className="tabular-nums">{children.length}</span>
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        aria-label="任务信息"
        onClick={() => openPanel("info")}
      >
        <Info className="size-4" />
        <span className="hidden sm:inline">详情</span>
      </Button>
      {localWorkflow && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="任务操作">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onNewTask && (
              <DropdownMenuItem onSelect={onNewTask}>
                <Plus />
                在此项目新建任务
              </DropdownMenuItem>
            )}
            {children.length > 0 && (
              <DropdownMenuItem onSelect={() => openPanel("children")}>
                <Workflow />
                子任务（{children.length}）
              </DropdownMenuItem>
            )}
            {onWorkflowCopy && (
              <DropdownMenuItem
                onSelect={() => {
                  void call<WorkflowRun>("workflow_run", { id: task.id })
                    .then((run) =>
                      onWorkflowCopy({
                        ...run.definition,
                        id: "",
                        revision: 0,
                      }),
                    )
                    .catch((error) => toast.error(String(error)));
                }}
              >
                <Copy />
                复制为新工作流
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => openPanel("log")}>
              <Terminal />
              原始日志
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {active &&
        (toolbarTarget ? (
          createPortal(toolbar, toolbarTarget)
        ) : toolbarTarget === undefined ? (
          <div className="flex shrink-0 justify-end border-b px-3 py-2">
            {toolbar}
          </div>
        ) : null)}
      <nav
        aria-label="会话资源"
        className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border/40 px-3 py-1"
      >
        {resources.map(({ id, label, icon: Icon, count, error }) => (
          <Button
            key={id}
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1.5 font-normal text-muted-foreground"
            aria-label={`${label}${count !== undefined ? ` ${count}` : ""}${unread[id] ? `，${unread[id]} 条未读` : ""}`}
            aria-expanded={info && tab === id}
            title={error || `查看${label}`}
            onClick={() => openPanel(id)}
          >
            <Icon className="size-3.5" />
            {label}
            {count !== undefined && (
              <span className="text-xs tabular-nums">{count}</span>
            )}
            {unread[id] > 0 && (
              <span className="animate-in fade-in duration-150 rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary motion-reduce:animate-none">
                未读 {unread[id]}
              </span>
            )}
            {error && (
              <span
                className="size-1.5 rounded-full bg-amber-500"
                aria-label="读取失败"
              />
            )}
          </Button>
        ))}
      </nav>
      <div
        ref={viewTransition}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {localWorkflow && (
          <div
            className={
              view === "workflow" ? "flex min-h-0 flex-1 flex-col" : "hidden"
            }
          >
            <WorkflowRunPanel
              key={task.id}
              agents={agents}
              task={task}
              tasks={tasks}
              active={active && view === "workflow"}
              onOpen={onOpen}
              onChanged={onChanged}
            />
          </div>
        )}
        {view === "workflow" ? null : view === "terminal" ? (
          terminalTask ? (
            <div
              className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
              aria-label="任务终端区域"
            >
              <PaneBoundary key={terminalTask.id} label="Agent 终端">
                <Suspense
                  fallback={
                    <div
                      role="status"
                      className="flex flex-1 items-center justify-center text-sm text-muted-foreground"
                    >
                      正在加载 Agent 终端…
                    </div>
                  }
                >
                  <TerminalView
                    id={terminalTask.id}
                    active={active}
                    running={terminalRunning}
                  />
                </Suspense>
              </PaneBoundary>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
              <Terminal className="size-6 text-muted-foreground" />
              <p className="text-sm">
                在终端中使用 {agentNames[task.agentKind] || task.agentKind}
              </p>
              <p className="max-w-md text-xs leading-6 text-muted-foreground">
                {task.sessionId
                  ? "通过原生会话恢复进入 Agent TUI，键盘、鼠标和滚动由终端处理。"
                  : "此记录没有可恢复的会话 ID，将打开新的 Agent TUI，可直接输入指令。"}
              </p>
              {terminalError && (
                <p
                  role="alert"
                  className="max-w-md break-words text-xs text-destructive"
                >
                  {terminalError}
                </p>
              )}
              <Button
                disabled={
                  busy ||
                  projectUnavailable ||
                  task.agentKind === "custom" ||
                  task.agentKind === "supervisor"
                }
                onClick={() => void connectTerminal()}
              >
                {busy
                  ? "正在连接…"
                  : isActive(current)
                    ? "停止当前执行并进入终端"
                    : "连接 Agent 终端"}
              </Button>
            </div>
          )
        ) : (
          <>
            <div className="relative flex min-h-0 flex-1 flex-col">
              <div
                ref={conversation.scroll}
                aria-label="对话消息"
                onScroll={conversation.onScroll}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
              >
                <div className="mx-auto max-w-3xl pl-4 pr-10 py-8 sm:pl-6 sm:pr-10">
                  {error ? (
                    <p role="alert" className="text-sm text-destructive">
                      {error}
                    </p>
                  ) : !detail ? (
                    <div className="space-y-5">
                      <Skeleton className="ml-auto h-16 w-3/4" />
                      <Skeleton className="h-32 w-full" />
                    </div>
                  ) : (
                    <>
                      <Transcript
                        onEditMessage={
                          detail?.revision &&
                          !isActive(current) &&
                          !terminalRunning &&
                          !current.deviceId &&
                          !current.parentId &&
                          !["supervisor", "terminal", "custom"].includes(
                            current.agentKind,
                          )
                            ? (index) => setEditing({ detail, index })
                            : undefined
                        }
                        items={conversation.items}
                        task={
                          conversation.atLatest
                            ? current
                            : { ...current, status: "completed" }
                        }
                        childTasks={children}
                        onOpen={onOpen}
                        onOpenFile={onOpenFile}
                      />
                      {approvalError && (
                        <p
                          role="alert"
                          className="mt-4 text-sm text-destructive"
                        >
                          无法读取审批：{approvalError}
                        </p>
                      )}
                      {conversation.atLatest && approvals.length > 0 && (
                        <div className="mt-6 space-y-3">
                          {approvals.length > 1 && (
                            <p className="text-xs text-muted-foreground">
                              {approvals.length} 项操作等待处理
                            </p>
                          )}
                          {approvals.map((request) => (
                            <ApprovalCard
                              key={request.id}
                              request={request}
                              busy={busy}
                              onAnswer={(answer) => {
                                void action("answer_approval", {
                                  id: task.id,
                                  approvalId: request.id,
                                  answer,
                                }).then(async () => {
                                  try {
                                    setApprovals(
                                      await call<Approval[]>("task_approvals", {
                                        id: task.id,
                                      }),
                                    );
                                  } catch (e) {
                                    toast.error(String(e));
                                  }
                                });
                              }}
                              onStop={() =>
                                void action("stop_task", { id: task.id }).then(
                                  (ok) => {
                                    if (ok) setApprovals([]);
                                  },
                                )
                              }
                            />
                          ))}
                        </div>
                      )}
                      {current.status === "waiting" &&
                        !approvals.length &&
                        !approvalError &&
                        !terminalRunning && (
                          <div
                            role="status"
                            className="mt-6 space-y-3 rounded-lg border p-4"
                          >
                            <p className="text-sm font-medium">任务需要操作</p>
                            <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                              {current.preview}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {task.deviceId
                                ? "请在执行任务的设备上处理审批。"
                                : "当前操作需在原生终端处理。"}
                            </p>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openPanel("log")}
                              >
                                查看日志
                              </Button>
                              {!task.deviceId &&
                                !["custom", "supervisor"].includes(
                                  task.agentKind,
                                ) && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setView("terminal")}
                                  >
                                    原生终端
                                  </Button>
                                )}
                            </div>
                          </div>
                        )}
                      {!detail.messages.length &&
                        current.status !== "running" && (
                          <p className="py-16 text-center text-sm text-muted-foreground">
                            任务启动后，对话将显示在这里。
                          </p>
                        )}
                    </>
                  )}
                </div>
              </div>
              <ConversationRail
                marks={conversation.marks}
                currentKey={conversation.currentKey}
                onJump={conversation.jump}
              />
              {conversation.showLatest && (
                <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
                  <Button
                    size="sm"
                    variant="outline"
                    className="pointer-events-auto rounded-full bg-background shadow-sm"
                    onClick={jumpToLatest}
                  >
                    <ArrowDown />
                    回到最新
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
        {view === "chat" && !localWorkflow && (
          <footer className="shrink-0 px-4 pb-4 pt-2 sm:px-6">
            {!!current.queuedMessages?.length && (
              <div className="mx-auto mb-2 max-h-36 max-w-3xl overflow-y-auto rounded-lg border p-2">
                <div className="flex items-center justify-between px-2 text-xs text-muted-foreground">
                  <span>待发送 · {current.queuedMessages.length}</span>
                  {!isActive(current) && (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busy || terminalRunning}
                      onClick={() =>
                        void action("run_queued_messages", { id: task.id })
                      }
                    >
                      继续队列
                    </Button>
                  )}
                </div>
                {current.queuedMessages.map((message) => (
                  <div
                    key={message.id}
                    className="flex items-center gap-2 px-2 py-1.5 text-xs"
                  >
                    <span className="shrink-0 text-muted-foreground">
                      {agents.find((a) => a.id === message.agentId)?.name ||
                        "Agent"}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate"
                      title={message.text}
                    >
                      {message.text}
                    </span>
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label="立即发送此消息"
                      disabled={busy || terminalRunning}
                      onClick={() =>
                        void action("run_queued_messages", {
                          id: task.id,
                          messageId: message.id,
                          immediate: true,
                        })
                      }
                    >
                      立即发送
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="移除待发送消息"
                      disabled={busy}
                      onClick={() =>
                        void action("remove_queued_message", {
                          id: task.id,
                          messageId: message.id,
                        })
                      }
                    >
                      <X />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {projectUnavailable ? (
              <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 py-3 text-xs text-muted-foreground">
                临时文件已清理，当前对话仅供查看。
                <Button variant="outline" size="sm" onClick={onNewTask}>
                  新建任务
                </Button>
              </div>
            ) : terminalRunning ? (
              <div className="mx-auto flex max-w-3xl items-center justify-between rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                <span>
                  {terminalTask?.sessionId &&
                  ["codex", "claude", "qwen", "qodercn"].includes(
                    terminalTask.agentKind,
                  )
                    ? "当前会话由终端接管输入。"
                    : "此终端尚未关联可同步的会话，请在终端查看。"}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setView("terminal")}
                >
                  进入终端
                </Button>
              </div>
            ) : (
              <ConversationComposer
                task={current}
                busy={busy}
                canContinue={canContinue}
                permissionPending={permissionBusy}
                agentKind={selectedAgent?.kind}
                configuration={
                  <div className="flex min-w-0 flex-wrap items-center gap-1 pl-1">
                    {selectedAgent && (
                      <AgentIcon
                        kind={selectedAgent.kind}
                        className="size-4 shrink-0"
                      />
                    )}
                    <Choice
                      label="接续 Agent"
                      value={nextAgent}
                      disabled={busy}
                      onChange={(id) => {
                        setNextAgent(id);
                        setPermission(
                          normalizePermission(
                            agents.find((a) => a.id === id)?.kind || "",
                          ),
                        );
                        setNextProvider("local");
                        setNextModel("");
                        setNextModelOptions({ ...emptyModelOptions });
                      }}
                      options={agents
                        .filter((a) => a.available)
                        .map((a) => ({ value: a.id, label: a.name }))}
                      className="h-7 max-w-44 border-0 bg-transparent text-xs shadow-none"
                    />
                  </div>
                }

                options={
                  selectedAgent &&
                  supportsModelPicker(
                    selectedAgent.kind,
                    selectedAgent.custom,
                  ) && (
                    <ModelPicker
                      key={nextAgent}
                      agent={selectedAgent}
                      project={task.project}
                      model={nextModel}
                      onModel={applyModel}
                      options={nextModelOptions}
                      onOptions={setNextModelOptions}
                      provider={nextProvider}
                      onProvider={(value) => {
                        setNextProvider(value);
                        setNextModel("");
                      }}
                      profiles={profiles}
                      disabled={busy}
                      remote={!!task.deviceId}
                      active={active}
                      open={settingsOpen}
                      onOpenChange={setSettingsOpen}
                      runtimeModels={commandCatalog.models}
                      nextTurn={isActive(current)}
                    />
                  )
                }

                suggestions={
                  <SlashCommands
                    prompt={prompt}
                    catalog={commandCatalog}
                    canCreate={!!onNewTask}
                    onChoose={(name) => {
                      if (name === "model") {
                        setSettingsOpen(true);
                        setPrompt("");
                      } else
                        setPrompt(
                          isNewChatCommand(name) ? `/${name}` : `/${name} `,
                        );
                    }}
                    onTerminal={
                      task.deviceId ? undefined : () => setView("terminal")
                    }
                  />
                }
                prompt={prompt}
                permission={permission}
                onPrompt={setPrompt}
                permissionLive={livePermission}
                onPermission={(value) => void changePermission(value)}
                onSend={(immediate) => void send(immediate)}
                onStart={() => void action("start_task", { id: task.id })}
                onStop={() => void action("stop_task", { id: task.id })}
                onRetry={() => onRetry(task)}
                onLog={() =>
                  approvals.length ? jumpToLatest() : openPanel("log")
                }
                hasApprovals={approvals.length > 0}
              />
            )}
          </footer>
        )}
      </div>
      <Sheet open={active && info} onOpenChange={setInfo}>
        <SheetContent
          className={cn(
            "gap-0 data-[side=right]:w-full transition-[max-width] duration-200 motion-reduce:transition-none",
            tab === "artifacts"
              ? "data-[side=right]:sm:max-w-4xl"
              : tab === "processes"
                ? "data-[side=right]:sm:max-w-2xl"
                : "data-[side=right]:sm:max-w-lg",
          )}
        >
          <SheetHeader>
            <SheetTitle>任务信息</SheetTitle>
            <SheetDescription>
              <span className="flex items-center gap-2">
                <AgentIcon kind={task.agentKind} className="size-3.5" />
                {agentNames[task.agentKind] || task.agentKind}
                <span>·</span>
                {projectName(task.project)}
              </span>
            </SheetDescription>
          </SheetHeader>
          <Tabs
            value={tab}
            onValueChange={setTab}
            className="min-h-0 flex-1 gap-0"
          >
            <TabsList className="mx-4 mb-3 w-auto shrink-0 justify-start overflow-x-auto">
              <TabsTrigger value="info">信息</TabsTrigger>
              <TabsTrigger value="processes">进程和服务</TabsTrigger>
              {!task.deviceId && !task.subagentId && (
                <TabsTrigger value="artifacts">产物</TabsTrigger>
              )}
              {children.length > 0 && (
                <TabsTrigger value="children">
                  子 Agent {children.length}
                </TabsTrigger>
              )}
              <TabsTrigger value="log">原始日志</TabsTrigger>
            </TabsList>
            {!task.deviceId && !task.subagentId && (
              <TabsContent
                value="artifacts"
                forceMount
                hidden={tab !== "artifacts"}
                className="m-0 flex min-h-0 flex-1 flex-col border-t data-[state=inactive]:hidden"
              >
                <WorkflowArtifacts
                  task={task}
                  active={active && info && tab === "artifacts"}
                  onOpenFile={
                    onOpenFile
                      ? (project, path, ...rest) => {
                          setInfo(false);
                          onOpenFile(project, path, ...rest);
                        }
                      : undefined
                  }
                />
              </TabsContent>
            )}
            <div
              className={cn(
                "min-h-0 flex-1 overflow-y-auto border-t p-5",
                tab === "artifacts" && "hidden",
              )}
            >
              <TabsContent
                key={task.id}
                value="processes"
                className="space-y-6"
              >
                <SessionProcesses commands={processes} />
                <SessionServices services={services} task={task} />
              </TabsContent>
              <TabsContent value="log">
                <pre className="whitespace-pre-wrap break-all rounded-lg bg-muted p-3 font-mono text-xs leading-6">
                  {detail?.log || "暂无原始日志"}
                </pre>
              </TabsContent>
              <TabsContent value="children">
                <div className="space-y-3">
                  {children.map((t) => (
                    <SubagentCard
                      key={t.id}
                      task={t}
                      onOpen={(child) => {
                        setInfo(false);
                        onOpen(child);
                      }}
                    />
                  ))}
                </div>
              </TabsContent>
              <TabsContent value="info" className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="record-title">任务名称</Label>
                  <div className="flex gap-2">
                    <Input
                      id="record-title"
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      maxLength={160}
                    />
                    <Button
                      variant="outline"
                      disabled={busy || !titleDraft.trim()}
                      onClick={() =>
                        void action("rename_task", {
                          id: task.id,
                          title: titleDraft,
                        }).then((ok) => {
                          if (ok) toast.success("名称已更新");
                        })
                      }
                    >
                      保存
                    </Button>
                  </div>
                </div>
                <dl className="space-y-4 text-sm">
                  {[
                    ...(ephemeral
                      ? [["会话类型", "临时对话 · 关闭后删除"]]
                      : []),
                    ...(task.deviceId
                      ? [
                          [
                            "设备",
                            `${task.deviceName || "局域网设备"}${task.deviceOnline === false ? " · 未连接，显示上次记录" : ""}`,
                          ],
                        ]
                      : []),
                    ...(parent ? [["父会话", parent.title]] : []),
                    ["项目目录", task.project],
                    ["模型", task.model || "Agent 默认模型"],
                    [
                      "状态",
                      <StatusBadge
                        key="task-status"
                        status={current.status}
                        terminal={
                          task.source === "terminal" || !!current.terminalId
                        }
                      />,
                    ],
                    ["创建时间", new Date(task.createdAt).toLocaleString()],
                    [
                      "输入 Token",
                      current.usage.known
                        ? current.usage.input.toLocaleString()
                        : "未上报",
                    ],
                    [
                      "输出 Token",
                      current.usage.known
                        ? current.usage.output.toLocaleString()
                        : "未上报",
                    ],
                    [
                      "缓存 Token",
                      current.usage.known
                        ? current.usage.cached.toLocaleString()
                        : "未上报",
                    ],
                    ["会话 ID", current.sessionId || "—"],
                    ["来源", task.source],
                    ["退出码", current.exitCode ?? "—"],
                  ].map(([label, value], index) => (
                    <div key={index}>
                      <dt className="mb-1 text-xs text-muted-foreground">
                        {label}
                      </dt>
                      <dd className="break-all">{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(task.project)
                        .then(() => toast.success("已复制目录"))
                        .catch(() => toast.error("无法访问剪贴板"))
                    }
                  >
                    <Copy />
                    复制目录
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void exportText(
                        `oiagent-${task.id}.md`,
                        `# ${task.title}\n\n项目：${task.project}\n\n${detail?.messages.map((m) => `## ${m.role}\n\n${m.tool ? JSON.stringify(m.tool, null, 2) : m.text}`).join("\n\n") || ""}`,
                      )
                        .then((saved) => {
                          if (saved) toast.success("已导出会话");
                        })
                        .catch((e) => toast.error(String(e)))
                    }
                  >
                    <Download />
                    导出对话
                  </Button>
                  <Button
                    variant="outline"
                    disabled={isActive(current)}
                    onClick={async () => {
                      const saved = await action("archive_task", {
                        id: task.id,
                        archived: !task.archived,
                      });
                      if (saved) {
                        setInfo(false);
                        onBack();
                      }
                    }}
                  >
                    <Archive />
                    {task.archived ? "恢复记录" : "归档记录"}
                  </Button>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </SheetContent>
      </Sheet>
      {editing && (
        <EditMessage
          detail={editing.detail}
          index={editing.index}
          hasUnsavedFiles={hasUnsavedFiles}
          onClose={() => setEditing(null)}
          onSaved={(next, replace) => {
            setEditing(null);
            if (onEdited) onEdited(next, replace);
            else onOpen(next);
            void onChanged();
          }}
        />
      )}
    </div>
  );
}
