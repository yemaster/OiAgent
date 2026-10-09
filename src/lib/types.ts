import { agentCatalog } from "./agents";
export type Status =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "imported";
export interface Usage {
  input: number;
  output: number;
  cached: number;
  known: boolean;
}
export interface Agent {
  id: string;
  name: string;
  kind: string;
  executable: string;
  args: string[];
  available: boolean;
  version: string;
  custom: boolean;
}
export interface Task {
  deviceId?: string;
  deviceName?: string;
  deviceOnline?: boolean;
  deviceWritable?: boolean;
  providerId?: string | null;
  usageByAgent?: Record<string, Usage>;
  extraArgs?: string[];
  envKeys?: string[];
  queuedMessages?: {
    id: string;
    text: string;
    createdAt: string;
    agentId: string;
    permission: string;
    model: string;
    providerId?: string | null;
  }[];
  terminalId?: string | null;
  id: string;
  title: string;
  prompt: string;
  project: string;
  agentId: string;
  agentKind: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
  preview: string;
  usage: Usage;
  sessionUsage?: Usage;
  sessionId: string | null;
  source: string;
  model: string;
  permission: string;
  exitCode: number | null;
  historyPath?: string;
  parentId?: string;
  subagentId?: string;
  subagentName?: string;
  archived: boolean;
}
export interface ToolEvent {
  callId: string;
  name: string;
  input: unknown;
  output: unknown;
  state: "called" | "running" | "completed" | "failed";
  childIds?: string[];
  parentCallId?: string | null;
}
export interface Message {
  agentKind?: string;
  role: string;
  text: string;
  timestamp: string;
  tool?: ToolEvent;
  parentCallId?: string;
  delta?: boolean;
}
export interface Detail {
  task: Task;
  messages: Message[];
  log: string;
}
export interface TemporaryProject {
  id: string;
  path: string;
  createdAt: string;
  status: "active" | "kept" | "cleaning" | "cleaned";
  cleanupAfter: string | null;
}
export interface Snapshot {
  temporaryProjects?: TemporaryProject[];
  remoteDevices?: import("./lan").RemoteDevice[];
  providers?: ProviderProfile[];
  agents: Agent[];
  tasks: Task[];
  projects: string[];
  warnings: string[];
  dataDir: string;
}
export interface TaskInput {
  providerId?: string | null;
  extraArgs?: string[];
  env?: Record<string, string>;
  title: string;
  prompt: string;
  project: string;
  agentId: string;
  model: string;
  permission: string;
  queued: boolean;
  resumeSession: string | null;
}
export type SettingsPageId =
  | "settings"
  | "settings-appearance"
  | "settings-llm"
  | "settings-lan"
  | "settings-about";
export type Page =
  | "todos"
  | "todos-completed"
  | "todos-edit"
  | "guide"
  | "tasks"
  | "history"
  | "archived"
  | "stats"
  | "new"
  | "agents"
  | "claude-api"
  | "claude-api-edit"
  | "integrations"
  | "instructions"
  | "workflow-edit"
  | "supervisor"
  | "plugins"
  | SettingsPageId;
export const statusLabels: Record<Status, string> = {
  queued: "待启动",
  running: "进行中",
  waiting: "等待操作",
  completed: "已完成",
  failed: "失败",
  cancelled: "已停止",
  interrupted: "已中断",
  imported: "历史会话",
};
export const agentNames: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(agentCatalog).map(([id, info]) => [id, info.name]),
  ),
  terminal: "终端",
  supervisor: "工作流",
  custom: "自定义 Agent",
};
export const isActive = (task: Task) =>
  ["running", "waiting", "queued"].includes(task.status);
export const projectName = (path: string) =>
  (path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) || path).replace(
    /^临时项目-([0-9a-f]{8})-[0-9a-f-]{27}$/,
    "临时项目 · $1",
  );
export const compact = (n: number) =>
  new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
export const tokens = (t: Task) => t.usage.input + t.usage.output;
export const relativeTime = (date: string) => {
  const minutes = Math.max(0, (Date.now() - new Date(date).getTime()) / 60000);
  return minutes < 1
    ? "刚刚"
    : minutes < 60
      ? `${Math.floor(minutes)} 分钟前`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)} 小时前`
        : `${Math.floor(minutes / 1440)} 天前`;
};
export function filterTasks(
  tasks: Task[],
  query: string,
  project = "all",
  agent = "all",
  status = "all",
) {
  const q = query.trim().toLocaleLowerCase();
  return tasks.filter(
    (t) =>
      (project === "all" || t.project === project) &&
      (agent === "all" || t.agentId === agent) &&
      (status === "all" || t.status === status) &&
      (!q ||
        [t.title, t.prompt, t.preview, t.project, t.agentKind, t.deviceName]
          .join(" ")
          .toLocaleLowerCase()
          .includes(q)),
  );
}
export function csv(tasks: Task[]) {
  const cell = (v: string | number) =>
    `"${String(v)
      .replace(/^[=+\-@]/, "'$&")
      .replaceAll('"', '""')}"`;
  return (
    "\uFEFF" +
    [
      [
        "任务",
        "项目",
        "Agent",
        "状态",
        "输入 Token",
        "输出 Token",
        "缓存 Token",
        "记录时间",
      ],
      ...tasks.map((t) => [
        t.title,
        t.project,
        t.agentId,
        statusLabels[t.status],
        t.usage.known ? t.usage.input : "",
        t.usage.known ? t.usage.output : "",
        t.usage.known ? t.usage.cached : "",
        t.updatedAt,
      ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}

export function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const values = groups.get(k);
    if (values) values.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

// Native transcripts contain cumulative usage. Count each native session once,
// even when several managed runs resume it.
export function usageRecords(tasks: Task[]): Task[] {
  const groups = groupBy(tasks, (t) =>
    t.subagentId || Object.keys(t.usageByAgent || {}).length > 1
      ? t.id
      : t.sessionId
        ? `${t.deviceId || "local"}:${t.agentKind}:${t.sessionId}`
        : t.id,
  );
  return [...groups.values()].map((group) => {
    const latest = group.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
    const native = group
      .map((t) => t.sessionUsage)
      .filter((u): u is Usage => !!u && u.known)
      .sort((a, b) => b.input + b.output - (a.input + a.output))[0];
    const summed = group.reduce(
      (u, t) => ({
        input: u.input + t.usage.input,
        output: u.output + t.usage.output,
        cached: u.cached + t.usage.cached,
        known: u.known || t.usage.known,
      }),
      { input: 0, output: 0, cached: 0, known: false },
    );
    return { ...latest, usage: native || summed };
  });
}

export function topLevelTasks(tasks: Task[]) {
  const ids = new Set(tasks.map((t) => t.id));
  return tasks.filter((t) => !t.parentId || !ids.has(t.parentId));
}

export interface ProviderProfile {
  id: string;
  name: string;
  baseUrl: string;
  authType: string;
  defaultModel: string;
  haikuModel: string;
  sonnetModel: string;
  opusModel: string;
  fableModel: string;
  hasKey: boolean;
}
