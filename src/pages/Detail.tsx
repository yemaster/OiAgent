import { WorkflowRunPanel } from "@/components/workspace/WorkflowRun";
import type { WorkflowDefinition } from "@/lib/workflows";
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
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import { call, exportText } from "@/lib/api";
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
}: {
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
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("info");
  const [showLatest, setShowLatest] = useState(false);
  const [info, setInfo] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [permission, setPermission] = useState(
    normalizePermission(task.agentKind, task.permission),
  );
  const [nextAgent, setNextAgent] = useState(task.agentId);
  const [nextProvider, setNextProvider] = useState(task.providerId || "local");
  const [nextModel, setNextModel] = useState(
    task.model === "默认模型" ? "" : task.model,
  );
  const [view, setView] = useState(
    task.source === "workflow" && !task.deviceId
      ? "workflow"
      : task.source === "terminal"
        ? "terminal"
        : "chat",
  );
  const [terminalError, setTerminalError] = useState("");
  const [connected, setConnected] = useState<Task | null>(null);
  const [visible, setVisible] = useState(80);
  const scroll = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const current = { ...detail?.task, ...task };
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
      : tasks.find((t) => t.id === current.terminalId) || connected;
  const terminalRunning = terminalTask?.status === "running";
  const selectedAgent = agents.find((a) => a.id === nextAgent);

  useEffect(() => {
    if (task.deviceId && (!active || task.deviceOnline === false)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const d = await call<Detail>("get_detail", {
          id:
            task.source === "terminal" && task.parentId
              ? task.parentId
              : task.id,
        });
        if (!stopped) {
          setDetail(d);
          setError("");
        }
      } catch (e) {
        if (!stopped) setError(String(e));
      } finally {
        if (!stopped)
          timer = setTimeout(
            load,
            active &&
              (terminalRunning ||
                ["running", "waiting", "queued"].includes(task.status))
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
    task.status,
    active,
    view,
    terminalRunning,
  ]);
  useEffect(() => {
    if (active && atBottom.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [detail?.messages.length, active]);
  async function connectTerminal() {
    setBusy(true);
    setTerminalError("");
    try {
      const terminal = await call<Task>("connect_agent_terminal", {
        id: task.id,
        stopCurrent: isActive(current),
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
  async function action(command: string, args: Record<string, unknown>) {
    setBusy(true);
    try {
      await call(command, args);
      await onChanged();
      return true;
    } catch (e) {
      toast.error(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!prompt.trim()) return;
    if (!selectedAgent?.available) {
      toast.error("请选择可用的 Agent");
      return;
    }
    setBusy(true);
    try {
      await call<Task>("queue_message", {
        id: task.id,
        text: prompt,
        agentId: nextAgent,
        permission,
        model: nextModel,
        providerId:
          selectedAgent?.kind === "claude" && nextProvider !== "local"
            ? nextProvider
            : null,
      });
      setPrompt("");
      await onChanged();
      const updated = await call<Detail>("get_detail", { id: task.id });
      setDetail(updated);
    } catch (e) {
      toast.error(String(e));
    } finally {
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
  function jumpToLatest() {
    atBottom.current = true;
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
    setShowLatest(false);
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <header className="flex min-h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-5">
        <IconButton
          label={parent ? "返回父会话" : "返回任务列表"}
          onClick={parent ? () => onOpen(parent) : onBack}
        >
          <ArrowLeft />
        </IconButton>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-medium" title={task.title}>
            {task.title}
          </h1>
          {task.deviceId && (
            <p className="truncate text-xs text-muted-foreground">
              {task.deviceName} ·{" "}
              {task.deviceOnline === false
                ? "未连接，显示上次记录"
                : "局域网设备"}
            </p>
          )}
          {parent && (
            <p className="truncate text-xs text-muted-foreground">
              子 Agent · {parent.title}
            </p>
          )}
        </div>
        {onNewTask && (
          <IconButton label="在此项目新建任务" onClick={onNewTask}>
            <Plus />
          </IconButton>
        )}
        {!task.subagentId && !task.deviceId && (
          <Tabs value={view} onValueChange={setView}>
            <TabsList className="h-7">
              <TabsTrigger value="chat" className="text-xs">
                对话
              </TabsTrigger>
              {task.source === "workflow" ? (
                <TabsTrigger value="workflow" className="text-xs">
                  工作流
                </TabsTrigger>
              ) : (
                task.source !== "supervisor" && (
                  <TabsTrigger value="terminal" className="text-xs">
                    终端
                  </TabsTrigger>
                )
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
              disabled={busy}
              onClick={() => void action("stop_task", { id: terminalTask.id })}
            >
              <Square />
              停止终端
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
          status={task.status}
          terminal={task.source === "terminal"}
        />
        {children.length > 0 && (
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
      </header>
      {view === "workflow" ? (
        <WorkflowRunPanel
          task={task}
          tasks={tasks}
          active={active}
          onOpen={onOpen}
          onChanged={onChanged}
          onCopy={onWorkflowCopy}
        />
      ) : view === "terminal" ? (
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
              ref={scroll}
              aria-label="对话消息"
              onScroll={() => {
                const el = scroll.current;
                if (el) {
                  atBottom.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 100;
                  setShowLatest(!atBottom.current);
                }
              }}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            >
              <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
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
                    {timeline.length > visible && (
                      <Button
                        variant="ghost"
                        className="mb-6 w-full text-xs text-muted-foreground"
                        onClick={() => {
                          const el = scroll.current;
                          const height = el?.scrollHeight || 0;
                          const top = el?.scrollTop || 0;
                          atBottom.current = false;
                          setVisible(visible + 80);
                          requestAnimationFrame(() => {
                            if (el)
                              el.scrollTop = top + el.scrollHeight - height;
                          });
                        }}
                      >
                        加载更早的消息（{timeline.length - visible}）
                      </Button>
                    )}
                    <Transcript
                      items={timeline.slice(-visible)}
                      task={current}
                      childTasks={children}
                      onOpen={onOpen}
                      onOpenFile={onOpenFile}
                    />
                    {!detail.messages.length && (
                      <p className="py-16 text-center text-sm text-muted-foreground">
                        任务启动后，对话将显示在这里。
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
            {showLatest && (
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
      {view !== "terminal" && (
        <footer className="shrink-0 px-4 pb-4 pt-2 sm:px-6">
          {!!current.queuedMessages?.length && (
            <div className="mx-auto mb-2 max-h-36 max-w-3xl overflow-y-auto rounded-lg border p-2">
              <div className="flex items-center justify-between px-2 text-xs text-muted-foreground">
                <span>待发送 · {current.queuedMessages.length}</span>
                {!["running", "queued"].includes(current.status) && (
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
                    size="icon-xs"
                    variant="ghost"
                    aria-label="撤回待发送消息"
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
          ) : task.source === "workflow" && !task.deviceId ? (
            <div className="mx-auto flex max-w-3xl items-center gap-3 py-3 text-sm text-muted-foreground">
              <span>在工作流视图中查看进度和处理待办。</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setView("workflow")}
              >
                查看执行步骤
              </Button>
            </div>
          ) : terminalRunning ? (
            <div className="mx-auto flex max-w-3xl items-center justify-between rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              <span>
                {terminalTask?.sessionId &&
                ["codex", "claude", "qwen"].includes(terminalTask.agentKind)
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
              agentKind={selectedAgent?.kind}
              configuration={
                <div className="flex flex-wrap items-center gap-2 px-1 pt-1">
                  <Choice
                    label="接续 Agent"
                    value={nextAgent}
                    onChange={(id) => {
                      setNextAgent(id);
                      setPermission(
                        normalizePermission(
                          agents.find((a) => a.id === id)?.kind || "",
                        ),
                      );
                      setNextProvider("local");
                      setNextModel("");
                    }}
                    options={agents
                      .filter((a) => a.available)
                      .map((a) => ({ value: a.id, label: a.name }))}
                    className="h-7 border-0 text-xs"
                  />
                  {!task.deviceId && selectedAgent?.kind === "claude" && (
                    <Choice
                      label="接续 API 配置"
                      value={nextProvider}
                      onChange={setNextProvider}
                      options={[
                        { value: "local", label: "本机 API 配置" },
                        ...profiles.map((p) => ({
                          value: p.id,
                          label: p.name,
                        })),
                      ]}
                      className="h-7 border-0 text-xs"
                    />
                  )}
                  <details className="ml-auto text-xs text-muted-foreground">
                    <summary className="cursor-pointer">模型</summary>
                    <Input
                      aria-label="接续模型"
                      className="mt-2 h-7 w-44 text-xs"
                      value={nextModel}
                      onChange={(e) => setNextModel(e.target.value)}
                      placeholder="使用程序 / API 默认模型"
                    />
                  </details>
                </div>
              }
              prompt={prompt}
              permission={permission}
              onPrompt={setPrompt}
              onPermission={setPermission}
              onSend={() => void send()}
              onStart={() => void action("start_task", { id: task.id })}
              onStop={() => void action("stop_task", { id: task.id })}
              onRetry={() => onRetry(task)}
              onLog={() => openPanel("log")}
            />
          )}
        </footer>
      )}
      <Sheet open={active && info} onOpenChange={setInfo}>
        <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
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
            <TabsList className="mx-4 mb-3 w-auto shrink-0">
              <TabsTrigger value="info">信息</TabsTrigger>
              {children.length > 0 && (
                <TabsTrigger value="children">
                  子 Agent {children.length}
                </TabsTrigger>
              )}
              <TabsTrigger value="log">原始日志</TabsTrigger>
            </TabsList>
            <div className="min-h-0 flex-1 overflow-y-auto border-t p-5">
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
                    ["项目目录", task.project],
                    ["模型", task.model || "Agent 默认模型"],
                    [
                      "状态",
                      <StatusBadge
                        key="task-status"
                        status={task.status}
                        terminal={task.source === "terminal"}
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
                    disabled={isActive(task)}
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
    </div>
  );
}
