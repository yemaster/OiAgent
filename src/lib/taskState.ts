import { isActive, type Task } from "./types";

/** Streaming output must not move an active task or its project under the pointer. */
export function taskOrderTime(task: Task): number {
  return Date.parse(isActive(task) ? task.createdAt : task.updatedAt) || 0;
}

export function compareTaskRecency(a: Task, b: Task): number {
  return taskOrderTime(b) - taskOrderTime(a) || a.id.localeCompare(b.id);
}

/** Polls, command replies and task events may arrive out of order. */
export function newerTask(current: Task, incoming?: Task): Task {
  if (!incoming || incoming.id !== current.id) return current;
  const previousTime = Date.parse(current.updatedAt) || 0;
  const incomingTime = Date.parse(incoming.updatedAt) || 0;
  // Rust timestamps retain sub-millisecond precision; Date.parse does not.
  if (previousTime === incomingTime && previousTime !== 0) {
    const fraction = (value: string) =>
      (value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] || "").padEnd(9, "0");
    if (fraction(incoming.updatedAt) < fraction(current.updatedAt))
      return current;
  }
  return incomingTime >= previousTime ? incoming : current;
}

/** A delayed task event may predate a context report read from native history. */
export function retainContext(task: Task, previous?: Task): Task {
  if (
    task.contextUsage ||
    !previous?.contextUsage ||
    task.id !== previous.id ||
    task.agentId !== previous.agentId ||
    task.agentKind !== previous.agentKind ||
    (task.providerId || null) !== (previous.providerId || null) ||
    (task.sessionId || null) !== (previous.sessionId || null)
  )
    return task;
  // Explicit compaction resets are objects with null counts, never absent data.
  return { ...task, contextUsage: previous.contextUsage };
}
