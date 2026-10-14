import { projectChoices } from "@/lib/temporaryProjects";
import { isNewChatCommand, slashCommand } from "@/lib/slashCommands";
import { useSendShortcut, matchesSendShortcut } from "@/lib/shortcuts";
import {
  preferredAgent,
  preferredPermission,
  rememberLaunchChoice,
} from "@/lib/launchPreferences";
import { ProjectPicker } from "@/components/workspace/ProjectPicker";
import type { TemporaryProject } from "@/lib/types";
import { TaskTemplates } from "@/components/workspace/TaskTemplates";
import { PromptOptimizer } from "@/components/workspace/PromptOptimizer";
import {
  normalizePermission,
  permissionOptions,
  parseLaunchOptions,
  type TaskDraft,
} from "@/lib/permissions";
import { useEffect, useEffectEvent, useState, useRef } from "react";
import {
  ArrowUp,
  Settings2,
  Monitor,
  Clock3,
  ArrowRight,
  Terminal,
  ChevronDown,
  Check,
  Workflow,
  MessageCircleDashed,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Choice, AgentIcon } from "@/components/workspace/shared";
import { call, desktop } from "@/lib/api";
import { type Agent, type Task, type Snapshot } from "@/lib/types";
import { remotePermissions } from "@/lib/lan";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
export function NewTaskPage({
  snapshot: localSnapshot,
  project,
  seed,
  onCreated,
  onSettings,
  onAgents,
  supervisor = false,
  draft,
  onDraftChange,
}: {
  snapshot: Snapshot;
  project: string;
  seed?: Task;
  onCreated: (t: Task) => void;
  onSettings: (draft: TaskDraft) => void;
  onAgents: (draft: TaskDraft) => void;
  draft?: TaskDraft;
  onDraftChange?: (draft: TaskDraft) => void;
  supervisor?: boolean;
}) {
  const [deviceId, setDeviceId] = useState(
    draft?.deviceId || seed?.deviceId || "local",
  );
  const remote = localSnapshot.remoteDevices?.find((d) => d.id === deviceId);
  const isRemote = deviceId !== "local";
  const snapshot: Snapshot = isRemote
    ? {
        ...localSnapshot,
        agents: remote?.snapshot?.agents || [],
        projects: remote?.snapshot?.projects || [],
        providers: [],
      }
    : localSnapshot;
  const unavailable =
    isRemote && (!remote?.online || !remote.snapshot?.allowExecution);
  const [mode, setMode] = useState(
    draft?.mode ?? (seed?.source === "terminal" ? "terminal" : "agent"),
  );
  const [agent, setAgent] = useState(
    draft?.agent ||
      seed?.agentId ||
      preferredAgent(snapshot.agents, deviceId)?.id ||
      "",
  );
  const [dir, setDir] = useState(
    draft?.dir ?? seed?.project ?? (project !== "all" ? project : ""),
  );
  const [ephemeral, setEphemeral] = useState(draft?.ephemeral ?? false);
  const [temporary, setTemporary] = useState(
    !isRemote &&
      (draft?.temporary ??
        (!dir ||
          !!snapshot.temporaryProjects?.some(
            (p) => p.path === dir && p.status === "active" && !p.ephemeral,
          ))),
  );
  const [temporaryPath, setTemporaryPath] = useState(
    draft?.temporaryPath || (temporary ? dir : ""),
  );
  const [prompt, setPrompt] = useState(draft?.prompt ?? seed?.prompt ?? "");
  const [title, setTitle] = useState(draft?.title ?? seed?.title ?? "");
  const [model, setModel] = useState(draft?.model ?? seed?.model ?? "");
  const [permission, setPermission] = useState(() =>
    supervisor
      ? normalizePermission("supervisor", draft?.permission ?? seed?.permission)
      : preferredPermission(
          deviceId,
          snapshot.agents.find((a) => a.id === agent),
          draft?.permission ??
            (seed
              ? normalizePermission(
                  snapshot.agents.find((a) => a.id === agent)?.kind || "",
                  seed.permission,
                )
              : undefined),
        ),
  );
  const [command, setCommand] = useState(
    draft?.command ?? (seed?.source === "terminal" ? seed.prompt : ""),
  );
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [maxTasks, setMaxTasks] = useState(draft?.maxTasks ?? "4");
  const [resume, setResume] = useState(
    draft?.resume ?? (!!seed?.sessionId && !seed?.subagentId),
  );
  const [llmReady, setLlmReady] = useState<boolean | null>(null);
  const [llmError, setLlmError] = useState("");
  const [providerId, setProviderId] = useState(
    draft?.providerId ?? seed?.providerId ?? "local",
  );
  const [argsText, setArgsText] = useState(
    draft?.argsText ?? seed?.extraArgs?.join("\n") ?? "",
  );
  const [envText, setEnvText] = useState(draft?.envText ?? "");
  useEffect(() => {
    if (agent || supervisor || mode !== "agent") return;
    const discovered = preferredAgent(snapshot.agents, deviceId);
    if (!discovered) return;
    // Discovery finishes after the cached workspace can already show the composer.
    // oxlint-disable-next-line react/set-state-in-effect
    setAgent(discovered.id);
    setPermission(preferredPermission(deviceId, discovered));
  }, [agent, supervisor, mode, snapshot.agents, deviceId]);
  const currentDraft = (): TaskDraft => ({
    ephemeral,
    temporary,
    temporaryPath,
    deviceId,
    mode,
    agent,
    dir,
    prompt,
    title,
    model,
    permission,
    command,
    maxTasks,
    resume,
    argsText,
    envText,
    providerId,
  });
  const rememberDraft = useEffectEvent(() => onDraftChange?.(currentDraft()));
  useEffect(() => {
    rememberDraft();
  }, [
    ephemeral,
    temporary,
    temporaryPath,
    deviceId,
    mode,
    agent,
    dir,
    prompt,
    title,
    model,
    permission,
    command,
    maxTasks,
    resume,
    argsText,
    envText,
    providerId,
  ]);
  useEffect(() => {
    if (!supervisor) return;
    let ignore = false;
    void call<{ configured: boolean }>("llm_status")
      .then((r) => {
        if (!ignore) setLlmReady(r.configured);
      })
      .catch((e) => {
        if (!ignore) setLlmError(String(e));
      });
    return () => {
      ignore = true;
    };
  }, [supervisor]);
  const sendShortcut = useSendShortcut();
  const selected = snapshot.agents.find((a) => a.id === agent);
  const managedPermissions =
    supervisor || (mode === "agent" && !selected?.custom);
  const supervisorAvailable = snapshot.agents.some(
    (a) => a.available && !a.custom,
  );
  const cannotSubmit =
    busy ||
    unavailable ||
    !desktop ||
    (!temporary && !dir.trim()) ||
    (mode !== "terminal" && !prompt.trim()) ||
    (supervisor && (llmReady !== true || !supervisorAvailable)) ||
    (mode === "agent" && !supervisor && !selected?.available) ||
    (mode === "command" && !command.trim());
  function rememberChoice(nextAgent: Agent, nextPermission: string) {
    try {
      rememberLaunchChoice(deviceId, nextAgent, nextPermission);
    } catch {
      toast.error("无法保存启动偏好，本次选择仍有效");
    }
  }
  async function submit(queued = false) {
    if (submitting.current) return;
    const localCommand = mode === "agent" ? slashCommand(prompt) : null;
    if (localCommand && isNewChatCommand(localCommand.name)) {
      if (localCommand.argument)
        toast.error(`/${localCommand.name} 不接受参数`);
      else setPrompt("");
      return;
    }
    if (cannotSubmit) return;
    if (unavailable) {
      toast.error("设备未连接或未授权执行任务");
      return;
    }
    if (!temporary && !dir.trim()) {
      toast.error("请选择项目目录");
      return;
    }
    if (mode !== "terminal" && !prompt.trim()) {
      toast.error("请输入任务内容");
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      let targetProject = dir;
      if (temporary && !isRemote) {
        if (temporaryPath) targetProject = temporaryPath;
        else {
          const allocated = await call<TemporaryProject>(
            "create_temporary_project",
            ...(ephemeral ? [{ ephemeral: true }] : []),
          );
          targetProject = allocated.path;
          setTemporaryPath(allocated.path);
        }
      }
      let task: Task;
      if (supervisor) {
        task = await call("start_supervisor", {
          prompt,
          project: targetProject,
          permission,
          maxTasks: Number(maxTasks),
        });
      } else if (mode === "terminal") {
        task = await call("terminal_start", {
          project: targetProject,
          command,
        });
      } else {
        let agentId = agent;
        if (mode === "command") {
          const [executable, args] = await call<[string, string[]]>(
            "parse_command",
            { command },
          );
          const custom = await call<Agent>("save_agent", {
            agent: {
              id: "",
              name: title || executable.split("/").at(-1) || "自定义命令",
              kind: "custom",
              executable,
              args,
              available: false,
              version: "",
              custom: true,
            },
          });
          agentId = custom.id;
        }
        task = await call("create_task", {
          ...(isRemote ? { deviceId } : {}),
          input: {
            title,
            prompt,
            project: targetProject,
            agentId,
            model,
            permission,
            queued,
            resumeSession:
              !temporary &&
              !isRemote &&
              resume &&
              mode === "agent" &&
              agent === seed?.agentId
                ? seed?.sessionId || null
                : null,
            ...(isRemote
              ? { extraArgs: [], env: {} }
              : parseLaunchOptions(argsText, envText)),
            providerId:
              !isRemote &&
              mode === "agent" &&
              selected?.kind === "claude" &&
              providerId !== "local"
                ? providerId
                : null,
          },
        });
      }
      onCreated(task);
      toast.success(queued ? "任务已加入待启动列表" : "任务已启动");
    } catch (e) {
      toast.error(String(e));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col px-5 py-6 lg:px-8">
      <div className="flex min-h-24 flex-1 items-center justify-center py-8">
        <h1 className="text-center text-2xl font-medium sm:text-3xl">
          {supervisor
            ? "要完成什么目标？"
            : seed
              ? "继续处理这个任务"
              : mode === "terminal"
                ? "从终端开始"
                : "有什么任务要处理？"}
        </h1>
      </div>
      <div className="shrink-0 space-y-3 pb-2">
        {supervisor && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {llmError ||
                (llmReady
                  ? "LLM API 已配置"
                  : llmReady === null
                    ? "正在读取 LLM 配置…"
                    : "尚未配置 LLM API")}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSettings(currentDraft())}
            >
              配置 LLM API
              <ArrowRight />
            </Button>
          </div>
        )}
        {unavailable && (
          <p role="status" className="text-xs text-destructive">
            设备未连接或未授权执行
          </p>
        )}
        {!supervisor &&
          mode === "agent" &&
          !snapshot.agents.some((a) => a.available) && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>没有可用的 Agent</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onAgents(currentDraft())}
              >
                管理程序
              </Button>
            </div>
          )}
        {supervisor && !supervisorAvailable && (
          <p className="text-xs text-muted-foreground">
            请先配置可用的 Agent 程序。
          </p>
        )}
        {!desktop && (
          <p className="text-xs text-muted-foreground">
            请在桌面 App 中启动任务
          </p>
        )}
        <div className="rounded-2xl border bg-card p-3 shadow-xs transition-shadow focus-within:ring-2 focus-within:ring-ring/15">
          {!supervisor && mode !== "agent" && (
            <div className="space-y-2.5">
              <Label htmlFor="launch-command">
                启动命令{mode === "terminal" ? "（可选）" : ""}
              </Label>
              <Input
                id="launch-command"
                placeholder={
                  mode === "terminal"
                    ? "留空打开 Shell，或输入 claude / codex / qwen"
                    : 'my-agent --prompt "{prompt}"'
                }
                className="h-9 bg-card font-mono text-sm"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
              />
              {mode === "command" && (
                <p className="text-xs text-muted-foreground">
                  支持 {"{prompt}"} 和 {"{project}"}，不执行 Shell 管道。
                </p>
              )}
            </div>
          )}

          {mode !== "terminal" && (
            <>
              <Label htmlFor="task-prompt" className="sr-only">
                {supervisor ? "任务目标" : "任务内容"}
              </Label>
              <Textarea
                id="task-prompt"
                placeholder={
                  supervisor ? "描述任务目标…" : "描述任务，按 Enter 开始…"
                }
                className="min-h-28 max-h-[35dvh] resize-none border-0 bg-transparent p-2 text-sm leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent"
                value={prompt}
                disabled={busy}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    matchesSendShortcut(e.nativeEvent, "enter") ||
                    matchesSendShortcut(e.nativeEvent, sendShortcut)
                  ) {
                    e.preventDefault();
                    if (!cannotSubmit) void submit();
                  }
                }}
              />
            </>
          )}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-dashed pt-2">
            <div
              role="group"
              aria-label="Agent 与权限"
              className="flex min-w-0 flex-wrap items-center gap-1"
            >
              {!supervisor && mode === "agent" && (
                <Popover open={agentOpen} onOpenChange={setAgentOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="选择 Agent"
                      className="max-w-48"
                      disabled={busy}
                    >
                      {selected && (
                        <AgentIcon kind={selected.kind} className="size-4" />
                      )}
                      <span className="truncate">
                        {selected?.name || "选择 Agent"}
                      </span>
                      <ChevronDown />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" side="top" className="w-72 p-3">
                    {!supervisor && mode === "agent" && (
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between">
                          <Label>执行 Agent</Label>
                          <Button
                            variant="link"
                            size="xs"
                            onClick={() => {
                              setAgentOpen(false);
                              onAgents(currentDraft());
                            }}
                            className="h-auto p-0 text-xs font-normal text-muted-foreground"
                          >
                            {isRemote ? "管理本机程序" : "管理程序"}
                          </Button>
                        </div>
                        <div className="grid max-h-60 gap-1 overflow-y-auto">
                          {snapshot.agents
                            .filter((a) => a.available)
                            .map((a) => (
                              <Button
                                key={a.id}
                                variant="outline"
                                disabled={!a.available}
                                aria-pressed={a.id === agent}
                                onClick={() => {
                                  const nextPermission = preferredPermission(
                                    deviceId,
                                    a,
                                  );
                                  setAgent(a.id);
                                  setAgentOpen(false);
                                  setPermission(nextPermission);
                                  rememberChoice(a, nextPermission);
                                  setResume(false);
                                }}
                                className={cn(
                                  "h-10 justify-start gap-2 text-xs font-normal shadow-none",
                                  a.id === agent &&
                                    "bg-accent border-foreground/30",
                                )}
                              >
                                <AgentIcon kind={a.kind} className="size-4" />
                                <span className="truncate">{a.name}</span>
                                {a.id === agent && (
                                  <Check className="ml-auto size-3.5" />
                                )}
                                {!a.available && (
                                  <span className="ml-auto text-muted-foreground">
                                    未安装
                                  </span>
                                )}
                              </Button>
                            ))}
                        </div>
                        {!snapshot.agents.some((a) => a.available) && (
                          <p className="text-xs leading-5 text-muted-foreground">
                            还没有可用程序。前往「管理程序」扫描本机
                            Agent，或手动添加。
                          </p>
                        )}
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              )}
              {managedPermissions && mode !== "terminal" && (
                <Choice
                  label="执行权限"
                  value={permission}
                  disabled={busy}
                  className="max-w-52 border-0 bg-transparent text-xs text-muted-foreground shadow-none"
                  onChange={(value) => {
                    setPermission(value);
                    if (!supervisor && selected)
                      rememberChoice(selected, value);
                  }}
                  options={(isRemote ? remotePermissions : permissionOptions)(
                    supervisor ? "supervisor" : selected?.kind || "",
                  )}
                />
              )}
            </div>
            <div
              role="group"
              aria-label="任务工具与发送"
              className="ml-auto flex shrink-0 items-center gap-1"
            >
              {mode !== "terminal" && (
                <>
                  <TaskTemplates prompt={prompt} onChange={setPrompt} />
                  <PromptOptimizer
                    prompt={prompt}
                    onChange={setPrompt}
                    onSettings={() => onSettings(currentDraft())}
                  />
                </>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="更多设置"
                title="更多设置"
                onClick={() => setOptionsOpen(true)}
                disabled={busy}
              >
                <Settings2 />
              </Button>
              <Button
                size="icon"
                className="rounded-full"
                disabled={cannotSubmit}
                aria-label={
                  busy
                    ? "正在启动…"
                    : supervisor
                      ? "启动自动派发"
                      : mode === "terminal"
                        ? "打开终端"
                        : "启动任务"
                }
                title={mode === "terminal" ? "打开终端" : "Enter 启动任务"}
                onClick={() => void submit()}
              >
                {supervisor ? (
                  <Workflow />
                ) : mode === "terminal" ? (
                  <Terminal />
                ) : (
                  <ArrowUp />
                )}
              </Button>
            </div>
          </div>
        </div>
        <div
          role="group"
          aria-label="任务位置与运行方式"
          className="flex flex-wrap items-center gap-1 text-muted-foreground"
        >
          {!ephemeral && (
            <ProjectPicker
              projects={projectChoices(snapshot).filter(
                (path) =>
                  !snapshot.temporaryProjects?.some(
                    (p) => p.path === path && p.status === "active",
                  ),
              )}
              value={dir}
              temporary={temporary}
              remote={isRemote}
              disabled={busy}
              onSelect={(path, temporary) => {
                if (path !== dir || temporary) setResume(false);
                setDir(path);
                setTemporary(temporary);
              }}
            />
          )}
          {!supervisor && !isRemote && mode === "agent" && (
            <Button
              variant={ephemeral ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={ephemeral}
              disabled={busy}
              title="关闭对话标签页后删除临时文件和记录"
              onClick={() => {
                setEphemeral(!ephemeral);
                setTemporary(true);
                setTemporaryPath("");
                setDir("");
                setResume(false);
              }}
            >
              <MessageCircleDashed />
              临时对话
            </Button>
          )}
          <span className="inline-flex items-center gap-1.5 px-2 text-xs">
            <Monitor className="size-3.5" />
            {isRemote ? remote?.snapshot?.name || remote?.name : "本机"}
          </span>
          {!supervisor && !isRemote && !ephemeral && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  disabled={busy}
                  aria-label="运行方式"
                >
                  {mode === "agent"
                    ? "Agent 对话"
                    : mode === "command"
                      ? "自定义命令"
                      : "交互终端"}
                  <ChevronDown className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-44">
                <DropdownMenuRadioGroup value={mode} onValueChange={setMode}>
                  {[
                    ["agent", "Agent 对话"],
                    ["command", "自定义命令"],
                    ["terminal", "交互终端"],
                  ].map(([value, label]) => (
                    <DropdownMenuRadioItem key={value} value={value}>
                      {label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      <Dialog open={optionsOpen} onOpenChange={setOptionsOpen}>
        <DialogContent
          className="max-h-[80dvh] overflow-y-auto sm:max-w-lg"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>更多设置</DialogTitle>
          </DialogHeader>
          {!supervisor &&
            (!!localSnapshot.remoteDevices?.length || isRemote) && (
              <div className="mb-6 space-y-2">
                <Label>执行设备</Label>
                <Choice
                  label="执行设备"
                  value={deviceId}
                  onChange={(id) => {
                    setDeviceId(id);
                    setEphemeral(false);
                    setTemporary(false);
                    setTemporaryPath("");
                    setMode("agent");
                    setProviderId("local");
                    setArgsText("");
                    setEnvText("");
                    setResume(false);
                    setModel("");
                    const target =
                      id === "local"
                        ? localSnapshot
                        : localSnapshot.remoteDevices?.find((d) => d.id === id)
                            ?.snapshot;
                    const first = preferredAgent(target?.agents || [], id);
                    setAgent(first?.id || "");
                    setPermission(preferredPermission(id, first));
                    setDir(target?.projects[0] || "");
                  }}
                  options={[
                    { value: "local", label: "本机" },
                    ...(localSnapshot.remoteDevices || []).map((d) => ({
                      value: d.id,
                      label: `${d.snapshot?.name || d.name}${d.online ? "" : " · 未连接"}`,
                    })),
                  ]}
                />
                {unavailable && (
                  <p role="status" className="text-xs text-destructive">
                    设备未连接或未授权执行，请在局域网连接设置中处理。
                  </p>
                )}
              </div>
            )}
          {!isRemote && mode === "agent" && selected?.kind === "claude" && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <Label>API 配置</Label>
              <Choice
                label="任务 API 配置"
                value={providerId}
                onChange={setProviderId}
                options={[
                  { value: "local", label: "沿用本机配置" },
                  ...(snapshot.providers || []).map((p) => ({
                    value: p.id,
                    label: p.name,
                  })),
                ]}
                className="min-w-48"
              />
            </div>
          )}
          {mode !== "terminal" && (
            <div className="space-y-4">
              {!supervisor && (
                <div className="space-y-2">
                  <Label htmlFor="task-title">任务名称（可选）</Label>
                  <Input
                    id="task-title"
                    placeholder="留空使用任务内容作为名称"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>
              )}
              {managedPermissions && (
                <div className="space-y-2">
                  <Label htmlFor="model">
                    {supervisor ? "最多子任务数" : "模型（可选）"}
                  </Label>
                  {supervisor ? (
                    <Choice
                      value={maxTasks}
                      onChange={setMaxTasks}
                      label="子任务上限"
                      options={[1, 2, 3, 4, 6, 8].map((n) => ({
                        value: String(n),
                        label: `${n} 个任务`,
                      }))}
                    />
                  ) : (
                    <Input
                      id="model"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="使用 Agent 默认模型"
                      disabled={mode === "command"}
                    />
                  )}
                </div>
              )}
              {!supervisor && !isRemote && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="extra-args">额外启动参数</Label>
                    <Textarea
                      id="extra-args"
                      className="min-h-20 font-mono text-xs"
                      value={argsText}
                      onChange={(e) => setArgsText(e.target.value)}
                      placeholder={"--config\n/path/to/config"}
                    />
                    <p className="text-xs text-muted-foreground">
                      每行一个参数，参数值单独一行。模型、权限及输出格式由上方选项管理。
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="launch-env">环境变量</Label>
                    <Textarea
                      id="launch-env"
                      autoComplete="off"
                      spellCheck={false}
                      className="min-h-20 font-mono text-xs"
                      value={envText}
                      onChange={(e) => setEnvText(e.target.value)}
                      placeholder="NAME=value"
                    />
                    <p className="text-xs text-muted-foreground">
                      每行
                      NAME=value，仅传给此任务。变量值仅保存在应用内存，重启后需重新填写。
                    </p>
                  </div>
                </>
              )}
              {!isRemote &&
                seed?.sessionId &&
                !seed.subagentId &&
                mode === "agent" &&
                agent === seed.agentId && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={resume}
                      onChange={(e) => setResume(e.target.checked)}
                    />
                    继续原会话的上下文
                  </label>
                )}
              {!supervisor && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={cannotSubmit}
                  onClick={() => void submit(true)}
                >
                  <Clock3 />
                  保存为待启动任务
                </Button>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setOptionsOpen(false)}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
