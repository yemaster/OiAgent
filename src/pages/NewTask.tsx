import { usePageTransition } from "@/hooks/usePageTransition";
import {
  preferredAgent,
  preferredPermission,
  rememberLaunchChoice,
} from "@/lib/launchPreferences";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TemporaryProject } from "@/lib/types";
import { TaskTemplates } from "@/components/workspace/TaskTemplates";
import { PromptOptimizer } from "@/components/workspace/PromptOptimizer";
import {
  normalizePermission,
  permissionOptions,
  parseLaunchOptions,
  type TaskDraft,
} from "@/lib/permissions";
import { useEffect, useEffectEvent, useState } from "react";
import {
  FolderOpen,
  Play,
  Clock3,
  ArrowRight,
  Terminal,
  ChevronDown,
  Check,
  Workflow,
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
import { Choice, PageHeading, AgentIcon } from "@/components/workspace/shared";
import { call, pickDirectory, desktop } from "@/lib/api";
import { projectName, type Agent, type Task, type Snapshot } from "@/lib/types";
import { remotePermissions } from "@/lib/lan";
import { cn } from "@/lib/utils";
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
  const [temporary, setTemporary] = useState(
    !isRemote && (draft?.temporary ?? !dir),
  );
  const formTransition = usePageTransition(`${mode}:${temporary}:${deviceId}`);
  const [temporaryPath, setTemporaryPath] = useState(
    draft?.temporaryPath || "",
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
  const currentDraft = (): TaskDraft => ({
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
  const selected = snapshot.agents.find((a) => a.id === agent);
  const managedPermissions =
    supervisor || (mode === "agent" && !selected?.custom);
  const supervisorAvailable = snapshot.agents.some(
    (a) => a.available && !a.custom,
  );
  function rememberChoice(nextAgent: Agent, nextPermission: string) {
    try {
      rememberLaunchChoice(deviceId, nextAgent, nextPermission);
    } catch {
      toast.error("无法保存启动偏好，本次选择仍有效");
    }
  }
  async function browse() {
    try {
      const p = await pickDirectory();
      if (p) setDir(p);
    } catch (e) {
      toast.error(String(e));
    }
  }
  async function submit(queued = false) {
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
    setBusy(true);
    try {
      let targetProject = dir;
      if (temporary && !isRemote) {
        if (temporaryPath) targetProject = temporaryPath;
        else {
          const allocated = await call<TemporaryProject>(
            "create_temporary_project",
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
              !isRemote && selected?.kind === "claude" && providerId !== "local"
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
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8 lg:px-10">
      <PageHeading
        title={supervisor ? "自动派发" : seed ? "重新运行任务" : "新建任务"}
      >
        {!supervisor && !isRemote && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="text-xs shadow-none"
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
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuRadioGroup value={mode} onValueChange={setMode}>
                {[
                  ["agent", "Agent 对话", "写下任务，由选中的 Agent 执行"],
                  ["command", "自定义命令", "指定程序与启动参数"],
                  ["terminal", "交互终端", "打开 Shell，自行输入命令和操作"],
                ].map(([value, label, hint]) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    <div>
                      <span>{label}</span>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {hint}
                      </p>
                    </div>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </PageHeading>
      {!supervisor && (!!localSnapshot.remoteDevices?.length || isRemote) && (
        <div className="mb-6 space-y-2">
          <Label>执行设备</Label>
          <Choice
            label="执行设备"
            value={deviceId}
            onChange={(id) => {
              setDeviceId(id);
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
      {supervisor && (
        <div className="mb-7 space-y-3 rounded-lg border p-4">
          <h2 className="text-sm font-medium">交给超级 Agent 协调</h2>
          <p className="text-[13px] leading-6 text-muted-foreground">
            写下最终目标，它会拆分任务、依次派发给本机
            Agent，再检查执行结果。每个子任务都能单独查看。
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
            <span className="text-muted-foreground">
              {llmError
                ? "无法读取 API 配置"
                : llmReady === null
                  ? "正在检查 LLM 配置…"
                  : llmReady
                    ? "LLM API 已配置"
                    : "开始前，需要连接一个 LLM API"}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSettings(currentDraft())}
              className="text-xs shadow-none"
            >
              配置 LLM API
              <ArrowRight className="size-3.5" />
            </Button>
          </div>
          {llmError && (
            <p role="alert" className="text-xs text-destructive">
              {llmError}
            </p>
          )}
        </div>
      )}
      <div ref={formTransition} className="space-y-6">
        <div className="space-y-2.5">
          {!isRemote && (
            <Tabs
              value={temporary ? "temporary" : "existing"}
              onValueChange={(value) => {
                setTemporary(value === "temporary");
                setResume(false);
              }}
            >
              <TabsList aria-label="项目类型">
                <TabsTrigger value="existing">已有项目</TabsTrigger>
                <TabsTrigger value="temporary">临时项目</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          {temporary && !isRemote ? (
            <p className="text-xs leading-6 text-muted-foreground">
              自动分配工作目录。文件在任务结束后保留；所有任务归档 7
              天后，下次启动时清理。需要长期使用时可保留项目。
            </p>
          ) : (
            <Label htmlFor="project-path">项目目录</Label>
          )}
          {!isRemote && !temporary && (
            <div className="flex gap-2">
              <Input
                id="project-path"
                placeholder="选择 Agent 工作的文件夹"
                value={dir}
                onChange={(e) => setDir(e.target.value)}
                className="h-9 bg-card"
              />
              <Button
                variant="outline"
                aria-label="选择项目文件夹"
                onClick={() => void browse()}
              >
                <FolderOpen className="size-4" />
                <span className="hidden sm:inline">浏览</span>
              </Button>
            </div>
          )}
          {!temporary && snapshot.projects.length > 0 && (
            <Choice
              value={snapshot.projects.includes(dir) ? dir : "none"}
              label="最近的项目"
              onChange={(v) => {
                if (v !== "none") setDir(v);
              }}
              options={[
                { value: "none", label: "从最近项目选择" },
                ...snapshot.projects.map((p) => ({
                  value: p,
                  label: projectName(p) + " · " + p,
                })),
              ]}
              className="max-w-full text-xs"
            />
          )}
        </div>
        {!supervisor && mode === "agent" && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label>执行 Agent</Label>
              <Button
                variant="link"
                size="xs"
                onClick={() => onAgents(currentDraft())}
                className="h-auto p-0 text-xs font-normal text-muted-foreground"
              >
                {isRemote ? "管理本机程序" : "管理程序"}
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {snapshot.agents
                .filter((a) => a.available)
                .map((a) => (
                  <Button
                    key={a.id}
                    variant="outline"
                    disabled={!a.available}
                    aria-pressed={a.id === agent}
                    onClick={() => {
                      const nextPermission = preferredPermission(deviceId, a);
                      setAgent(a.id);
                      setPermission(nextPermission);
                      rememberChoice(a, nextPermission);
                      setResume(false);
                    }}
                    className={cn(
                      "h-10 justify-start gap-2 text-xs font-normal shadow-none",
                      a.id === agent && "bg-accent border-foreground/30",
                    )}
                  >
                    <AgentIcon kind={a.kind} className="size-4" />
                    <span className="truncate">{a.name}</span>
                    {a.id === agent && <Check className="ml-auto size-3.5" />}
                    {!a.available && (
                      <span className="ml-auto text-muted-foreground">
                        未安装
                      </span>
                    )}
                  </Button>
                ))}
            </div>
            {!isRemote && selected?.kind === "claude" && (
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
            {!snapshot.agents.some((a) => a.available) && (
              <p className="text-xs leading-5 text-muted-foreground">
                还没有可用程序。前往「管理程序」扫描本机 Agent，或手动添加。
              </p>
            )}
          </div>
        )}
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
            <p className="text-xs leading-5 text-muted-foreground">
              {mode === "terminal"
                ? "连接系统终端，可以直接输入命令并处理权限确认。终端内程序的细分状态与 Token 不自动推断。"
                : "使用 {prompt} 和 {project} 插入任务内容与项目目录。命令按参数解析，不执行 Shell 管道。"}
            </p>
          </div>
        )}
        {(supervisor || mode !== "terminal") && (
          <>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="task-prompt">
                  {supervisor ? "任务目标" : "任务内容"}
                </Label>
                <div className="flex items-center gap-1">
                  <TaskTemplates prompt={prompt} onChange={setPrompt} />
                  <PromptOptimizer
                    prompt={prompt}
                    onChange={setPrompt}
                    onSettings={() => onSettings(currentDraft())}
                  />
                </div>
              </div>
              <Textarea
                id="task-prompt"
                placeholder={
                  supervisor
                    ? "描述最终目标和验收条件…"
                    : "例如：检查登录接口的错误处理，指出问题并给出修改建议。"
                }
                className="min-h-40 resize-y bg-card p-3 text-sm leading-6"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>
            {managedPermissions && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>执行权限</Label>
                <Choice
                  value={permission}
                  onChange={(value) => {
                    setPermission(value);
                    if (!supervisor && selected)
                      rememberChoice(selected, value);
                  }}
                  label="执行权限"
                  className="text-xs"
                  options={(isRemote ? remotePermissions : permissionOptions)(
                    supervisor ? "supervisor" : selected?.kind || "",
                  )}
                />
              </div>
            )}
            <details className="rounded-md border px-4 py-3">
              <summary className="cursor-pointer text-xs font-medium">
                更多设置{resume ? " · 继续原会话" : ""}
              </summary>
              <div className="mt-4 space-y-4">
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
                    disabled={
                      busy ||
                      unavailable ||
                      !desktop ||
                      (!temporary && !dir.trim()) ||
                      !prompt.trim() ||
                      (mode === "agent" && !selected?.available) ||
                      (mode === "command" && !command.trim())
                    }
                    onClick={() => void submit(true)}
                  >
                    <Clock3 />
                    保存为待启动任务
                  </Button>
                )}
              </div>
            </details>
          </>
        )}
        {supervisor && !supervisorAvailable && (
          <p className="text-xs leading-5 text-muted-foreground">
            自动派发需要至少一个可用的内置 Agent 程序。请先在左侧「Agent
            程序」中完成设置。
          </p>
        )}
        {supervisor && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">执行范围与数据使用</summary>
            <p className="mt-2 leading-6">
              目标和子任务输出会发送到你配置的 LLM API。各 Agent
              沿用本机登录配置；单个子任务限时 30
              分钟。检查依据为执行日志，不替代人工代码审查。
            </p>
          </details>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
          <span className="text-xs text-muted-foreground">
            {!desktop
              ? "请在桌面 App 中启动本机任务"
              : !managedPermissions
                ? "使用程序自身的权限设置"
                : "任务按项目保存，可随时回来继续"}
          </span>
          <Button
            disabled={
              busy ||
              unavailable ||
              !desktop ||
              (!temporary && !dir.trim()) ||
              (mode !== "terminal" && !prompt.trim()) ||
              (supervisor && (llmReady !== true || !supervisorAvailable)) ||
              (mode === "agent" && !supervisor && !selected?.available) ||
              (mode === "command" && !command.trim())
            }
            onClick={() => void submit()}
          >
            {supervisor ? (
              <Workflow />
            ) : mode === "terminal" ? (
              <Terminal />
            ) : (
              <Play />
            )}
            {busy
              ? "正在启动…"
              : supervisor
                ? "启动自动派发"
                : mode === "terminal"
                  ? "打开终端"
                  : "启动任务"}
          </Button>
        </div>
      </div>
    </div>
  );
}
