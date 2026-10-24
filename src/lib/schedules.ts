import type { Agent, Status } from "./types";
import { normalizePermission } from "./permissions";
export type ScheduleRule =
  | { kind: "once"; at: string }
  | { kind: "interval"; minutes: number }
  | { kind: "daily"; time: string; timezone: string }
  | { kind: "weekly"; time: string; timezone: string; weekdays: number[] };
export type ScheduleTarget =
  | {
      kind: "agent";
      agentId: string;
      prompt: string;
      permission: string;
      model: string;
      providerId: string | null;
    }
  | { kind: "workflow"; workflowId: string };
export interface ScheduleDefinition {
  id: string;
  revision: number;
  name: string;
  project: string;
  target: ScheduleTarget;
  rule: ScheduleRule;
  enabled: boolean;
  catchUp: boolean;
}
export interface ScheduleRun {
  id: string;
  scheduledAt: string;
  startedAt: string;
  trigger: "manual" | "schedule";
  status: Status | "starting" | "skipped";
  message: string;
  taskId: string | null;
}
export interface Schedule {
  definition: ScheduleDefinition;
  nextRunAt: string | null;
  runs: ScheduleRun[];
}
export const weekdays = [
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六",
  "周日",
];
export function localTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
export function newSchedule(agents: Agent[], project = ""): ScheduleDefinition {
  const agent = agents.find((a) => a.available);
  return {
    id: "",
    revision: 0,
    name: "",
    project: project === "all" ? "" : project,
    target: {
      kind: "agent",
      agentId: agent?.id || "",
      prompt: "",
      permission: normalizePermission(agent?.kind || ""),
      model: "",
      providerId: null,
    },
    rule: { kind: "daily", time: "09:00", timezone: localTimezone() },
    enabled: true,
    catchUp: false,
  };
}
export function scheduleTime(value: string, timezone?: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "short",
      day: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}
export function scheduleSummary(rule: ScheduleRule) {
  if (rule.kind === "once") return `仅一次 · ${scheduleTime(rule.at)}`;
  if (rule.kind === "interval")
    return rule.minutes % 60 === 0
      ? `每 ${rule.minutes / 60} 小时`
      : `每 ${rule.minutes} 分钟`;
  return `${
    rule.kind === "daily"
      ? "每天"
      : [...rule.weekdays]
          .sort((a, b) => a - b)
          .map((d) => weekdays[d])
          .join("、")
  } ${rule.time}`;
}
export function isScheduleRunActive(run: ScheduleRun) {
  return ["starting", "queued", "running", "waiting", "stopping"].includes(
    run.status,
  );
}
export function scheduleBusy(item: Schedule) {
  return item.runs.some(isScheduleRunActive);
}
export function validateSchedule(def: ScheduleDefinition) {
  if (!def.name.trim()) return "请填写名称";
  if (!def.project.trim()) return "请选择项目目录";
  if (def.target.kind === "agent") {
    if (!def.target.agentId) return "请选择 Agent";
    if (!def.target.prompt.trim()) return "请填写任务内容";
  } else if (!def.target.workflowId) return "请选择工作流";
  const r = def.rule;
  if (
    r.kind === "once" &&
    (!r.at ||
      Number.isNaN(Date.parse(r.at)) ||
      (def.enabled && Date.parse(r.at) <= Date.now()))
  )
    return "请选择未来的执行时间";
  if (
    r.kind === "interval" &&
    (!Number.isInteger(r.minutes) || r.minutes < 1 || r.minutes > 43200)
  )
    return "执行间隔需为 1–43200 分钟";
  if (r.kind === "weekly" && !r.weekdays.length) return "请选择每周执行的日期";
  return "";
}
