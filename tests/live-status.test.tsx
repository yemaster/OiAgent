import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { LiveTaskStatus } from "@/components/workspace/LiveTaskStatus";
import { call } from "@/lib/api";
import { listen } from "@tauri-apps/api/event";
import { buildTranscript } from "@/lib/transcript";
vi.mock("@/lib/api", () => ({ call: vi.fn(), desktop: true }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => vi.fn()),
}));
beforeEach(() => {
  vi.clearAllMocks();
});
it("uses newer events rather than a stale status snapshot, and clears on recovery", async () => {
  let reply!: (value: unknown) => void;
  vi.mocked(call).mockImplementation(
    async () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  render(<LiveTaskStatus id="a" active />);
  await act(async () => {});
  const notify = vi.mocked(listen).mock.calls[0][1];
  act(() =>
    notify({ payload: { id: "a", text: "Reconnecting... 2/5" } } as never),
  );
  await act(async () => reply("Reconnecting... 1/5"));
  expect(screen.getByRole("status")).toHaveTextContent("2/5");
  act(() => notify({ payload: { id: "b", text: "other task" } } as never));
  expect(screen.getByRole("status")).toHaveTextContent("2/5");
  act(() => notify({ payload: { id: "a", text: null } } as never));
  expect(screen.queryByRole("status")).toBeNull();
});
it("filters old transport records without changing source indexes or user/tool content", () => {
  const text = "Reconnecting... 1/5 (workspace routing discovery timed out)";
  const timeline = buildTranscript([
    { role: "system", text, timestamp: "" },
    { role: "user", text, timestamp: "" },
    { role: "system", text: "模型：claude", timestamp: "" },
    {
      role: "tool",
      text: "Bash",
      timestamp: "",
      tool: { callId: "x", name: "Bash", output: text, state: "completed" },
    },
  ]);
  expect(timeline).toHaveLength(3);
  expect(timeline[0]).toMatchObject({ message: { sourceIndex: 1, text } });
  expect(timeline[2]).toMatchObject({ tool: { output: text } });
});
