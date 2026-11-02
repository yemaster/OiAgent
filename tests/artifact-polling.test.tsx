import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useTaskArtifacts } from "@/hooks/useTaskArtifacts";
import { call } from "@/lib/api";

vi.mock("@/lib/api", () => ({ call: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("polls artifacts on a fixed cadence through token updates, reuses unchanged data, and pauses in the background", async () => {
  vi.useFakeTimers();
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("visible");
  vi.mocked(call)
    .mockReset()
    .mockImplementation(async () => ({
      files: [
        {
          path: "/repo/a.ts",
          project: "/repo",
          relativePath: "a.ts",
          stepIds: [],
          size: 12,
          error: null,
        },
      ],
      truncated: false,
    }));
  const { result, rerender } = renderHook(
    ({ version }) =>
      useTaskArtifacts("task", "stable-artifact-poll", true, version, true),
    {
      initialProps: { version: 0 },
    },
  );
  await act(async () => {});
  const data = result.current.data;
  expect(call).toHaveBeenCalledTimes(1);
  for (let version = 1; version <= 10; version++) {
    rerender({ version });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
  }
  expect(call).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(call).toHaveBeenCalledTimes(2);
  expect(result.current.data).toBe(data);
  // A revision still advances so an open preview sees edits of the same size.
  expect(result.current.revision).toBe(2);
  expect(result.current.loading).toBe(false);
  act(() => {
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(call).toHaveBeenCalledTimes(2);
  await act(async () => {
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(call).toHaveBeenCalledTimes(3);
});
