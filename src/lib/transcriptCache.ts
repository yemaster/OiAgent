import { buildTranscript, type TranscriptItem } from "./transcript";
import { stepChanges, type StepChange } from "./stepChanges";
import type { Message, ToolEvent } from "./types";

// IPC JSON has fresh objects even for unchanged records. Share equal immutable
// branches so streaming a new event doesn't invalidate every old code/diff view.
function share(previous: unknown, next: unknown, depth = 0): unknown {
  if (previous === next) return previous;
  if (
    depth > 64 ||
    !previous ||
    !next ||
    typeof previous !== "object" ||
    typeof next !== "object"
  )
    return next;
  if (Array.isArray(previous) !== Array.isArray(next)) return next;
  const a = previous as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  const keys = Object.keys(b);
  let equal = Object.keys(a).length === keys.length;
  let result: Record<string, unknown> | undefined;
  for (const key of keys) {
    const value = share(a[key], b[key], depth + 1);
    equal = equal && Object.hasOwn(a, key) && value === a[key];
    // Most of a streamed transcript is unchanged. Clone only the first changed
    // branch instead of allocating and discarding every object on every poll.
    if (!equal && !result)
      result = Array.isArray(previous)
        ? (previous.slice() as unknown as Record<string, unknown>)
        : { ...a };
    if (result)
      Object.defineProperty(result, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  }
  if (equal) return previous;
  if (!result) return next;
  for (const key of Object.keys(result))
    if (!Object.hasOwn(b, key)) delete result[key];
  if (Array.isArray(result) && Array.isArray(next)) result.length = next.length;
  return result;
}

/** One instance per conversation; discarded on task changes, not a global cache. */
export function createTranscriptReader() {
  let previous: TranscriptItem[] = [];
  return (messages: Message[]) => {
    previous = share(previous, buildTranscript(messages)) as TranscriptItem[];
    return previous;
  };
}

export function createChangeReader() {
  const cache = new WeakMap<ToolEvent, Map<string, StepChange[]>>();
  return function read(
    items: TranscriptItem[],
    project: string,
    parent = "",
  ): StepChange[] {
    const rows: StepChange[] = [];
    for (const item of items) {
      if (item.kind !== "tool") continue;
      const step = `${parent}/${item.key}`;
      const key = JSON.stringify([project, step, item.timestamp]);
      let entries = cache.get(item.tool);
      if (!entries) {
        entries = new Map();
        cache.set(item.tool, entries);
      }
      let changes = entries.get(key);
      if (!changes) {
        changes = stepChanges(item.tool, project, step, item.timestamp);
        entries.set(key, changes);
      }
      for (const change of changes) rows.push(change);
      for (const change of read(item.nested, project, step)) rows.push(change);
    }
    return rows;
  };
}
