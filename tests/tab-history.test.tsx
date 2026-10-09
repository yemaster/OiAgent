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
