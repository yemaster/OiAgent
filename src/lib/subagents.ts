import { isActive, type Status, type Task } from "./types";

export type SubagentState = Status | "offline";
export const subagentStates: {
  value: SubagentState;
  label: string;
  tone?: string;
}[] = [
  { value: "running", label: "进行中", tone: "text-sky-700 dark:text-sky-400" },
  {
    value: "waiting",
    label: "待处理",
    tone: "text-amber-700 dark:text-amber-400",
  },
  { value: "failed", label: "失败", tone: "text-destructive" },
  {
    value: "interrupted",
    label: "中断",
    tone: "text-amber-700 dark:text-amber-400",
  },
  { value: "queued", label: "待启动" },
  { value: "stopping", label: "终止中" },
  { value: "completed", label: "完成" },
  { value: "cancelled", label: "已停止" },
  { value: "imported", label: "历史会话" },
  { value: "offline", label: "待同步" },
];
export function subagentState(task: Task): SubagentState {
  return task.deviceOnline === false && isActive(task)
    ? "offline"
    : task.status;
}
export function subagentCounts(tasks: Task[]) {
  const counts = new Map<SubagentState, number>();
  for (const task of tasks) {
    const state = subagentState(task);
    counts.set(state, (counts.get(state) || 0) + 1);
  }
  return subagentStates.flatMap((state) => {
    const count = counts.get(state.value) || 0;
    return count ? [{ ...state, count }] : [];
  });
}
/** Status and streaming timestamps must not reorder people under the pointer. */
export function orderSubagents(tasks: Task[]) {
  return tasks.toSorted(
    (a, b) =>
      (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) ||
      a.id.localeCompare(b.id),
  );
}
export const subagentName = (task: Task) => task.subagentName || task.title;
