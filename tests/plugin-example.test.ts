import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import bootstrap from "@/lib/extensions/worker-bootstrap.js?raw";
import example from "../examples/plugins/project-notes/main.js?raw";
import { validateUi } from "@/lib/extensions/ui";
it("runs the shipped example through the real SDK message protocol", async () => {
  const messages: {
    type: string;
    method?: string;
    params?: unknown;
    tree?: unknown;
  }[] = [];
  let listener!: (event: { data: object }) => Promise<void>;
  let storage: Record<string, unknown> = {};
  const context = {
    setTimeout,
    clearTimeout,
    addEventListener: (_: string, callback: typeof listener) => {
      listener = callback;
    },
    postMessage: (message: {
      type: string;
      id?: number;
      method?: string;
      params?: unknown;
    }) => {
      messages.push(message);
      if (message.type !== "request") return;
      let result: unknown = null;
      if (message.method === "workspace.context")
        result = { project: "/repo", taskId: null };
      if (message.method === "storage.get") result = structuredClone(storage);
      if (message.method === "storage.set")
        storage = structuredClone(message.params as Record<string, unknown>);
      queueMicrotask(
        () =>
          void listener({ data: { type: "response", id: message.id, result } }),
      );
    },
  };
  runInNewContext(`${bootstrap}\n${example}`, context);
  await listener({
    data: {
      type: "open",
      payload: {
        viewId: "notes",
        settings: { "task-prefix": "Review: " },
        values: {},
      },
    },
  });
  const rendered = messages.find((m) => m.type === "render")!;
  expect(validateUi(rendered.tree).type).toBe("stack");
  await listener({
    data: {
      type: "action",
      payload: {
        action: "save",
        values: { title: "Changes", notes: "Check API" },
      },
    },
  });
  expect(storage["/repo"]).toEqual({ title: "Changes", notes: "Check API" });
  await listener({
    data: {
      type: "action",
      payload: {
        action: "draft",
        values: { title: "Changes", notes: "Check API" },
      },
    },
  });
  expect(messages).toContainEqual(
    expect.objectContaining({
      type: "request",
      method: "tasks.draft",
      params: { title: "Review: Changes", prompt: "Check API" },
    }),
  );
  expect(messages.some((m) => m.type === "error")).toBe(false);
});
