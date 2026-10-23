import { expect, it } from "vitest";
import {
  createTranscriptReader,
  createChangeReader,
} from "@/lib/transcriptCache";
import { buildTranscript } from "@/lib/transcript";
import { conversationChanges, stepChanges } from "@/lib/stepChanges";
import type { Message, ToolEvent } from "@/lib/types";

const edit = (id: string, patch: Partial<ToolEvent> = {}): Message => ({
  role: "tool",
  text: "",
  timestamp: "t",
  tool: {
    callId: id,
    name: "Edit",
    input: { file_path: "a.ts", old_string: "old", new_string: "new" },
    output: null,
    state: "called",
    ...patch,
  },
});
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
it("shares unchanged IPC records and diffs but incorporates out-of-order tool results", () => {
  const timeline = createTranscriptReader();
  const changes = createChangeReader();
  const messages = [edit("a"), edit("b")];
  const first = timeline(clone(messages));
  const initial = changes(first, "/repo");
  expect(timeline(clone(messages))).toBe(first);
  const updated = [
    ...messages,
    edit("b", { input: null, state: "completed", output: "done" }),
  ];
  const next = timeline(clone(updated));
  expect(next).toEqual(buildTranscript(updated));
  expect(next[0]).toBe(first[0]);
  expect(next[1]).not.toBe(first[1]);
  const result = changes(next, "/repo");
  expect(result).toEqual(conversationChanges(next, "/repo"));
  expect(result[0]).toBe(initial[0]);
  expect(result[1].state).toBe("completed");
  expect(initial[1].state).toBe("called");
  expect(changes(next, "/other")).toEqual(conversationChanges(next, "/other"));
});
it("invalidates replaced histories, preserves nested scopes, and retains editable source indices", () => {
  const timeline = createTranscriptReader();
  const changes = createChangeReader();
  const messages: Message[] = [
    { role: "user", text: "first", timestamp: "t" },
    edit("parent", { name: "Agent", input: { prompt: "work" } }),
    { ...edit("a"), parentCallId: "parent" },
    edit("a"),
    { role: "user", text: "second", timestamp: "t" },
  ];
  const first = timeline(messages);
  expect(changes(first, "/repo")).toEqual(conversationChanges(first, "/repo"));
  expect(new Set(changes(first, "/repo").map((v) => v.id)).size).toBe(2);
  const replaced = [
    { role: "user", text: "replacement", timestamp: "t" } as Message,
    edit("new"),
  ];
  const result = timeline(replaced);
  expect(result).toEqual(buildTranscript(replaced));
  expect(changes(result, "/repo")).toEqual(
    conversationChanges(result, "/repo"),
  );
  expect(result[0]).toMatchObject({
    message: { sourceIndex: 0, text: "replacement" },
  });
  expect(timeline([])).toEqual([]);
  expect(changes(timeline(messages), "/repo")).toEqual(
    conversationChanges(first, "/repo"),
  );
});
it("retains every file's own evidence in a large native edit, including the first duplicate", () => {
  const files = Array.from({ length: 3000 }, (_, i) => ({
    path: `file-${i}.ts`,
    kind: "update",
    before: `old-${i}`,
    after: `new-${i}`,
  }));
  const message = edit("batch", {
    name: "file_change",
    input: { changes: [...files, { ...files[0], before: "wrong duplicate" }] },
  });
  const rows = stepChanges(message.tool!, "/repo");
  expect(rows).toHaveLength(3000);
  for (let i = 0; i < rows.length; i++)
    expect(rows[i]).toMatchObject({ before: `old-${i}`, after: `new-${i}` });
});

it("drops removed fields and array tails without mutating previous tool evidence", () => {
  const read = createTranscriptReader();
  const initial = [
    edit("a", {
      input: {
        file_path: "a.ts",
        old_string: "old",
        new_string: "new",
        nested: { removed: "large", kept: [1, 2, 3] },
      },
    }),
    edit("b"),
  ];
  const first = read(clone(initial));
  const replacement = [
    edit("a", {
      input: {
        file_path: "a.ts",
        old_string: "old",
        new_string: "new",
        nested: { added: "small", kept: [1] },
      },
    }),
  ];
  const next = read(clone(replacement));
  expect(next).toEqual(buildTranscript(replacement));
  expect(first).toEqual(buildTranscript(initial));
  expect(read(clone(replacement))).toBe(next);
  expect(read([])).toEqual([]);
  expect(read(clone(initial))).toEqual(first);
});
