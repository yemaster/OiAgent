import type { Task } from "./types";

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
