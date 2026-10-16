import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSessionServices } from "@/hooks/useSessionServices";
import { call } from "@/lib/api";
import type { SessionCommand } from "@/lib/sessionActivity";
vi.mock("@/lib/api", () => ({ call: vi.fn() }));
const command: SessionCommand = {
  id: "session:server",
  command: "cd /project && PORT=8080 node server.js",
  timestamp: "",
  output: "",
  summary: "",
  state: "running",
  background: true,
  language: "bash",
};
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("discovers silent servers after a successful port check and removes closed ports", async () => {
  vi.useFakeTimers();
  vi.mocked(call).mockResolvedValue([{ port: 8080, reachable: false }]);
  const { result, unmount } = renderHook(() =>
    useSessionServices([command], true),
  );
  await act(async () => {});
  expect(result.current).toEqual([]);
  vi.mocked(call).mockResolvedValue([{ port: 8080, reachable: true }]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(result.current).toEqual([
    expect.objectContaining({ port: 8080, reachable: true }),
  ]);
  vi.mocked(call).mockResolvedValue([{ port: 8080, reachable: false }]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(result.current).toEqual([]);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
it("does not probe inactive or remote views and ignores late replies after switching tasks", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(call).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { result, rerender } = renderHook(
    ({ enabled, commands }) => useSessionServices(commands, enabled),
    {
      initialProps: { enabled: false, commands: [command] },
    },
  );
  expect(call).not.toHaveBeenCalled();
  rerender({ enabled: true, commands: [command] });
  await waitFor(() =>
    expect(call).toHaveBeenCalledWith("probe_service_ports", { ports: [8080] }),
  );
  rerender({ enabled: true, commands: [] });
  await act(async () => resolve([{ port: 8080, reachable: true }]));
  expect(result.current).toEqual([]);
});

it("never reuses a previous task's reachability for the same launch command", async () => {
  vi.mocked(call).mockResolvedValueOnce([{ port: 8080, reachable: true }]);
  const { result, rerender } = renderHook(
    ({ scope }) => useSessionServices([command], true, scope),
    { initialProps: { scope: "task-a" } },
  );
  await waitFor(() => expect(result.current).toHaveLength(1));
  vi.mocked(call).mockImplementation(() => new Promise(() => {}));
  rerender({ scope: "task-b" });
  expect(result.current).toEqual([]);
});
