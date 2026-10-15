import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useActivityNotices } from "@/hooks/useActivityNotices";
import { useTaskArtifacts } from "@/hooks/useTaskArtifacts";
import { call } from "@/lib/api";

vi.mock("@/lib/api", () => ({ call: vi.fn() }));

it("tracks newly arriving records, marks only the viewed category, and restores read markers", () => {
  const first = { processes: ["c1"], artifacts: ["a1:10"] };
  const initialProps = {
    id: "notices-task",
    keys: first,
    viewing: undefined as string | undefined,
  };
  const hook = renderHook(
    ({ id, keys, viewing }) => useActivityNotices(id, keys, viewing),
    { initialProps },
  );
  expect(hook.result.current).toEqual({
    processes: 1,
    artifacts: 1,
  });
  hook.rerender({ ...initialProps, viewing: "processes" });
  expect(hook.result.current).toEqual({
    processes: 0,
    artifacts: 1,
  });
  const next = { ...first, processes: ["c1", "c2"] };
  hook.rerender({ ...initialProps, keys: next });
  expect(hook.result.current.processes).toBe(1);
  hook.rerender({ ...initialProps, keys: next, viewing: "processes" });
  hook.rerender({
    ...initialProps,
    keys: { ...next, processes: ["c1", "c2", "c3"] },
    viewing: "processes",
  });
  hook.rerender({
    ...initialProps,
    keys: { ...next, processes: ["c1", "c2", "c3"] },
  });
  expect(hook.result.current.processes).toBe(0);
  hook.unmount();
  const restored = renderHook(() =>
    useActivityNotices("notices-task", {
      ...next,
      processes: ["c1", "c2", "c3", "c4"],
    }),
  );
  expect(restored.result.current).toEqual({
    processes: 1,
    artifacts: 1,
  });
  restored.unmount();
  const other = renderHook(() => useActivityNotices("another-task", first));
  expect(other.result.current.processes).toBe(1);
});

it("preserves read markers from the former command and service tabs", () => {
  localStorage.setItem(
    "oiagent-activity-read:migrated-task",
    JSON.stringify({
      commands: ["c1"],
      services: ["s1"],
      artifacts: ["file:10"],
    }),
  );
  const { result } = renderHook(() =>
    useActivityNotices("migrated-task", {
      processes: ["command:c1", "service:s1", "command:c2"],
      artifacts: ["file:10"],
    }),
  );
  expect(result.current).toEqual({ processes: 1, artifacts: 0 });
});

it("shares artifact listing requests between the notice and panel without loading file bodies", async () => {
  vi.mocked(call).mockClear();
  vi.mocked(call).mockResolvedValue({ files: [], truncated: false });
  const notice = renderHook(() =>
    useTaskArtifacts("task", "shared-artifacts", true, "1"),
  );
  const pane = renderHook(() =>
    useTaskArtifacts("task", "shared-artifacts", true, "1"),
  );
  await waitFor(() => expect(notice.result.current.data).toBeDefined());
  expect(pane.result.current.data).toEqual(notice.result.current.data);
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith("task_artifacts", {
    id: "shared-artifacts",
  });
  await act(() => pane.result.current.refresh());
  expect(call).toHaveBeenCalledTimes(2);
});

it("refreshes active task counts and stops polling when the tab becomes inactive", async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(call).mockClear();
    vi.mocked(call).mockResolvedValue({ files: [], truncated: false });
    const hook = renderHook(
      ({ enabled }) =>
        useTaskArtifacts("task", "live-artifacts", enabled, "1", true),
      { initialProps: { enabled: true } },
    );
    await act(() => Promise.resolve());
    expect(call).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(5100));
    expect(call).toHaveBeenCalledTimes(2);
    hook.rerender({ enabled: false });
    await act(() => vi.advanceTimersByTimeAsync(15000));
    expect(call).toHaveBeenCalledTimes(2);
    hook.unmount();
  } finally {
    vi.useRealTimers();
  }
});
