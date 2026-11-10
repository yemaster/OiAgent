import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createOutputBuffer,
  createTaskOutput,
  type OutputEvent,
} from "@/lib/taskOutput";
import { call } from "@/lib/api";
import { DetailPage } from "@/pages/Detail";
import { TooltipProvider } from "@/components/ui/tooltip";
import { demoSnapshot } from "@/lib/demo";
import type { Message } from "@/lib/types";

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage?: (event: OutputEvent) => void;
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => vi.fn()),
}));
vi.mock("@/lib/api", () => ({
  call: vi.fn(),
  desktop: true,
  exportText: vi.fn(),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(call).mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) =>
    window.clearTimeout(id),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const row = (text: string, streamId = "a", delta = true): Message => ({
  role: "assistant",
  text,
  timestamp: "t",
  streamId,
  delta,
});
function receiver() {
  return vi
    .mocked(call)
    .mock.calls.find(([command]) => command === "subscribe_task_output")![1]!
    .onOutput as { onmessage: (event: OutputEvent) => void };
}

it("renders native chunks on the next frame, batches bursts and has no polling or typing timer", async () => {
  const update = vi.fn();
  const output = createTaskOutput("task", update);
  receiver().onmessage({
    type: "snapshot",
    messages: [row("已有", "a", false)],
    truncated: false,
  });
  for (let i = 0; i < 500; i++)
    receiver().onmessage({ type: "record", message: row("字") });
  expect(update).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(16);
  expect(update).toHaveBeenCalledTimes(1);
  expect(update.mock.lastCall![0].messages[0].text).toBe(
    "已有" + "字".repeat(500),
  );
  expect(vi.getTimerCount()).toBe(0);
  expect(call).toHaveBeenCalledTimes(1);
  receiver().onmessage({
    type: "record",
    message: row("最终回答", "a", false),
  });
  await vi.advanceTimersByTimeAsync(16);
  expect(update.mock.lastCall![0].messages[0].text).toBe("最终回答");
  expect(update.mock.lastCall![0].messages).toHaveLength(1);
  output.dispose();
});

it("cancels pending frames and unregisters even when native subscription completes after hiding", async () => {
  let registered!: () => void;
  vi.mocked(call).mockImplementation((command) =>
    command === "subscribe_task_output"
      ? new Promise<void>((resolve) => {
          registered = resolve;
        })
      : Promise.resolve(),
  );
  const update = vi.fn();
  const output = createTaskOutput("task", update);
  const channel = receiver();
  channel.onmessage({ type: "snapshot", messages: [], truncated: false });
  channel.onmessage({ type: "record", message: row("queued") });
  output.dispose();
  registered();
  await vi.advanceTimersByTimeAsync(5000);
  channel.onmessage({ type: "record", message: row("late") });
  expect(update).not.toHaveBeenCalled();
  expect(output.ready()).toBe(false);
  expect(
    vi
      .mocked(call)
      .mock.calls.filter(([command]) => command === "unsubscribe_task_output"),
  ).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("preserves immutable history, Unicode and parallel block identities with bounded memory", () => {
  const buffer = createOutputBuffer();
  const history = { role: "user", text: "问题", timestamp: "t" };
  buffer.reset({ messages: [history], truncated: false });
  buffer.push(row("中文 👩‍💻\n"));
  const previous = buffer.snapshot();
  buffer.push({ ...row("child"), parentCallId: "child" });
  buffer.push(row("  下一行"));
  const current = buffer.snapshot();
  expect(current.messages[0]).toBe(history);
  expect(previous.messages[1].text).toBe("中文 👩‍💻\n");
  expect(current.messages[1].text).toBe("中文 👩‍💻\n  下一行");
  expect(current.messages[2].text).toBe("child");
  for (let i = 0; i < 1000; i++) buffer.push(row(String(i), String(i), false));
  expect(buffer.snapshot().messages).toHaveLength(500);
  expect(buffer.snapshot().truncated).toBe(true);
  buffer.push(row("x".repeat(2 * 1024 * 1024), "huge", false));
  expect(buffer.snapshot().messages).toHaveLength(0);
});

it("keeps direct output when an older detail read returns, then unsubscribes on a hidden pane", async () => {
  const task = {
    ...demoSnapshot.tasks[0],
    id: "live",
    status: "running",
    source: "managed",
  };
  let oldRead!: (value: unknown) => void;
  vi.mocked(call).mockImplementation(async (command) => {
    if (command === "get_detail")
      return new Promise((resolve) => {
        oldRead = resolve;
      });
    return [];
  });
  const page = (active: boolean) => (
    <TooltipProvider>
      <DetailPage
        task={task}
        tasks={[task]}
        agents={demoSnapshot.agents}
        profiles={[]}
        active={active}
        onBack={vi.fn()}
        onOpen={vi.fn()}
        onChanged={async () => {}}
        onRetry={vi.fn()}
      />
    </TooltipProvider>
  );
  const view = render(page(true));
  await act(async () => {
    receiver().onmessage({
      type: "snapshot",
      messages: [row("原生", "a", false)],
      truncated: false,
    });
    receiver().onmessage({ type: "record", message: row("增量") });
    await vi.advanceTimersByTimeAsync(16);
  });
  expect(screen.getByText("原生增量")).toBeVisible();
  await act(async () => {
    oldRead({ task, log: "", messages: [row("旧的磁盘快照", "a", false)] });
    await Promise.resolve();
  });
  expect(screen.getByText("原生增量")).toBeVisible();
  expect(screen.queryByText("旧的磁盘快照")).not.toBeInTheDocument();
  view.rerender(page(false));
  expect(
    vi
      .mocked(call)
      .mock.calls.some(([command]) => command === "unsubscribe_task_output"),
  ).toBe(true);
});
