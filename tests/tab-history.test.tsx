import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useTabHistory, type WorkspaceLocation } from "@/hooks/useTabHistory";

it("returns across task and file tabs in visit order, then restores the previous page", () => {
  const page: WorkspaceLocation = {
    kind: "page",
    page: "history",
    project: "/project",
  };
  const taskA = { kind: "task", id: "a" } as const;
  const taskB = { kind: "task", id: "b" } as const;
  const file = { kind: "file", id: "file", taskId: "a" } as const;
  const available = ["task:a", "task:b", "file:file"];
  const { result, rerender } = renderHook(
    ({ current, available }) => useTabHistory(current, available),
    {
      initialProps: { current: page as WorkspaceLocation, available },
    },
  );
  rerender({ current: taskA, available });
  rerender({ current: file, available });
  rerender({ current: taskB, available });
  rerender({ current: taskA, available });
  expect(result.current(taskA)).toEqual(taskB);
  rerender({ current: taskB, available: ["task:b", "file:file"] });
  expect(result.current(taskB)).toEqual(file);
  rerender({ current: file, available: ["file:file"] });
  expect(result.current(file)).toEqual(page);
});

it("closing background tabs leaves the visible tab or page unchanged and skips closed history", () => {
  const a = { kind: "task", id: "a" } as const;
  const b = { kind: "file", id: "b" } as const;
  const page = { kind: "page", page: "agents", project: "all" } as const;
  const available = ["task:a", "file:b"];
  const { result, rerender } = renderHook(
    ({ current }) => useTabHistory(current, available),
    {
      initialProps: { current: a as WorkspaceLocation },
    },
  );
  rerender({ current: b });
  act(() => expect(result.current(a)).toBeNull());
  rerender({ current: page });
  expect(result.current(b)).toBeNull();
});

it("returns to the Skills page before older open tabs and retains its scope", () => {
  const task = { kind: "task", id: "a" } as const;
  const page: WorkspaceLocation = {
    kind: "page",
    page: "integrations",
    project: "all",
    integrationKind: "claude",
    integrationContext: {
      kind: "claude",
      project: "/picked/project",
      tab: "skills",
    },
  };
  const file = { kind: "file", id: "skill" } as const;
  const available = ["task:a", "file:skill"];
  const { result, rerender } = renderHook(
    ({ current }) => useTabHistory(current, available),
    { initialProps: { current: task as WorkspaceLocation } },
  );
  rerender({ current: page });
  rerender({ current: file });
  expect(result.current(file)).toEqual(page);
});

it("removes closed background tabs in a batch before another render", () => {
  const page: WorkspaceLocation = {
    kind: "page",
    page: "integrations",
    project: "all",
  };
  const a = { kind: "task", id: "a" } as const;
  const b = { kind: "file", id: "b" } as const;
  const c = { kind: "file", id: "c" } as const;
  const available = ["task:a", "file:b", "file:c"];
  const { result, rerender } = renderHook(
    ({ current }) => useTabHistory(current, available),
    { initialProps: { current: page } },
  );
  rerender({ current: a });
  rerender({ current: b });
  rerender({ current: c });
  act(() => {
    expect(result.current(a)).toBeNull();
    expect(result.current(b)).toBeNull();
    expect(result.current(c)).toEqual(page);
  });
});

it("updates configuration context in place and respects subsequent tab visits", () => {
  const page: WorkspaceLocation = {
    kind: "page",
    page: "instructions",
    project: "all",
    instructionContext: { kind: "codex", project: "user" },
  };
  const changed: WorkspaceLocation = {
    ...page,
    instructionContext: { kind: "claude", project: "/project" },
  };
  const file = { kind: "file", id: "instruction" } as const;
  const task = { kind: "task", id: "a" } as const;
  const available = ["file:instruction", "task:a"];
  const { result, rerender } = renderHook(
    ({ current }) => useTabHistory(current, available),
    { initialProps: { current: page } },
  );
  rerender({ current: changed });
  rerender({ current: file });
  rerender({ current: task });
  rerender({ current: file });
  expect(result.current(file)).toEqual(task);
  expect(result.current(task)).toEqual(changed);
});

it("skips completed API editor drafts when restoring a page after closing a tab", () => {
  const page: WorkspaceLocation = {
    kind: "page",
    page: "claude-api-edit",
    project: "all",
    providerEditorId: "saved-draft",
  };
  const file = { kind: "file", id: "file" } as const;
  const { result, rerender } = renderHook(
    ({ current, valid }) => useTabHistory(current, ["file:file"], () => valid),
    { initialProps: { current: page, valid: true } },
  );
  rerender({ current: file, valid: false });
  expect(result.current(file)).toEqual({
    kind: "page",
    page: "tasks",
    project: "all",
  });
});
