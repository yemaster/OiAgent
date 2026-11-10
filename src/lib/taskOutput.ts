import { Channel } from "@tauri-apps/api/core";
import { call } from "./api";
import type { Message } from "./types";

export type OutputSnapshot = { messages: Message[]; truncated: boolean };
export type OutputEvent =
  | ({ type: "snapshot" } & OutputSnapshot)
  | { type: "record"; message: Message };

const MAX_ROWS = 500;
const MAX_BYTES = 2 * 1024 * 1024;
function identity(message: Message) {
  const id = message.streamId ?? message.reasoning?.id;
  return id == null
    ? undefined
    : JSON.stringify([message.parentCallId, message.role, id]);
}

/** Keep immutable visible rows; append tokens only to their own response block. */
export function createOutputBuffer() {
  let rows: Message[] = [];
  let sizes: number[] = [];
  let bytes = 0;
  let truncated = false;
  const positions = new Map<string, number>();
  function index() {
    positions.clear();
    rows.forEach((row, i) => {
      const key = identity(row);
      if (key !== undefined) positions.set(key, i);
    });
  }
  function trim() {
    let removed = 0;
    while (rows.length - removed > MAX_ROWS || bytes > MAX_BYTES) {
      bytes -= sizes[removed++];
      truncated = true;
    }
    if (removed) {
      rows = rows.slice(removed);
      sizes = sizes.slice(removed);
      index();
    }
  }
  return {
    reset(snapshot: OutputSnapshot) {
      rows = snapshot.messages.slice();
      sizes = rows.map((row) => JSON.stringify(row).length * 2);
      bytes = sizes.reduce((sum, size) => sum + size, 0);
      truncated = snapshot.truncated;
      index();
      trim();
    },
    push(row: Message) {
      const key = identity(row);
      let i = key === undefined ? undefined : positions.get(key);
      const last = rows.at(-1);
      // Providers without block IDs still expose adjacent plain-text deltas.
      if (
        key === undefined &&
        row.delta &&
        !row.tool &&
        last &&
        !last.tool &&
        !identity(last) &&
        last.role === row.role &&
        last.parentCallId === row.parentCallId
      )
        i = rows.length - 1;
      const size = JSON.stringify(row).length * 2;
      if (i === undefined) {
        if (key !== undefined) positions.set(key, rows.length);
        rows.push(row);
        sizes.push(size);
        bytes += size;
      } else {
        const previous = rows[i];
        const text = row.delta ? previous.text + row.text : row.text;
        const nextSize =
          Math.max(
            sizes[i] - previous.text.length * 2,
            size - row.text.length * 2,
          ) +
          text.length * 2;
        rows[i] = {
          ...previous,
          ...row,
          text,
          timestamp: previous.timestamp,
          nativeId: row.nativeId ?? previous.nativeId,
        };
        bytes += nextSize - sizes[i];
        sizes[i] = nextSize;
      }
      trim();
    },
    snapshot(): OutputSnapshot {
      return { messages: rows.slice(), truncated };
    },
  };
}

/** The native Channel delivers an atomic baseline followed by ordered records.
 * No read timer or artificial typing delay; render only on frames with new data.
 */
export function createTaskOutput(
  id: string,
  update: (snapshot: OutputSnapshot) => void,
) {
  const subscription = crypto.randomUUID();
  const channel = new Channel<OutputEvent>();
  const buffer = createOutputBuffer();
  let disposed = false;
  let ready = false;
  let frame: number | undefined;
  function unsubscribe() {
    void call("unsubscribe_task_output", { subscription }).catch(() => {});
  }
  channel.onmessage = (event) => {
    if (disposed) return;
    if (event.type === "snapshot") {
      buffer.reset(event);
      ready = true;
    } else if (ready) buffer.push(event.message);
    else return;
    frame ??= requestAnimationFrame(() => {
      frame = undefined;
      if (!disposed) update(buffer.snapshot());
    });
  };
  void call("subscribe_task_output", { id, subscription, onOutput: channel })
    .then(() => {
      // Cleanup may have run before the native registration finished.
      if (disposed) unsubscribe();
    })
    .catch(() => {
      ready = false;
    }); // Detail polling remains the fallback.
  return {
    ready: () => ready && !disposed,
    dispose() {
      disposed = true;
      ready = false;
      if (frame !== undefined) cancelAnimationFrame(frame);
      unsubscribe();
    },
  };
}
