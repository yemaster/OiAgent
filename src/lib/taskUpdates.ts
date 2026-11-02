import { newerTask } from "./taskState";
import type { Task } from "./types";

/** Keep list order and references when an event is stale or unchanged. */
export function applyTaskUpdates(
  tasks: Task[],
  updates: Iterable<Task>,
): Task[] {
  const incoming = new Map(Array.from(updates, (task) => [task.id, task]));
  let changed = false;
  const next = tasks.map((previous) => {
    const update = incoming.get(previous.id);
    incoming.delete(previous.id);
    const latest = newerTask(previous, update);
    if (
      latest === previous ||
      JSON.stringify(previous) === JSON.stringify(latest)
    )
      return previous;
    changed = true;
    return latest;
  });
  return incoming.size
    ? [...incoming.values(), ...next]
    : changed
      ? next
      : tasks;
}

/** Coalesce output bursts; lifecycle/approval changes are delivered immediately. */
export function createTaskUpdateQueue(
  commit: (tasks: Task[], urgent: boolean) => void,
) {
  const pending = new Map<string, Task>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  function flush(urgent = false) {
    clearTimeout(timer);
    timer = undefined;
    if (!pending.size || disposed) return;
    const tasks = [...pending.values()];
    pending.clear();
    commit(tasks, urgent);
  }
  return {
    push(task: Task) {
      if (disposed) return;
      pending.set(task.id, newerTask(pending.get(task.id) || task, task));
      if (task.status !== "running") flush(true);
      else timer ??= setTimeout(() => flush(), 100);
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      pending.clear();
    },
  };
}
