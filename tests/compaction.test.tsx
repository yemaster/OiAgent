import { expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { buildTranscript } from "@/lib/transcript";
import { normalizeCompaction, compactionOutcome } from "@/lib/compaction";
import { Transcript } from "@/components/workspace/Transcript";
import { demoSnapshot } from "@/lib/demo";
import type { Message } from "@/lib/types";

function event(outcome: string, id = "", parentCallId?: string): Message {
  return {
    role: "tool",
    text: "context_compaction",
    timestamp: "now",
    agentKind: "claude",
    tool: {
      name: "context_compaction",
      callId: id,
      state:
        outcome === "running"
          ? "running"
          : outcome === "failed"
            ? "failed"
            : "completed",
      input: null,
      output: { outcome },
      parentCallId,
    },
  };
}
function message(text: string, role = "assistant"): Message {
  return { role, text, timestamp: "now", agentKind: "claude" };
}
const task = {
  ...demoSnapshot.tasks[0],
  status: "running",
  agentKind: "claude",
};
const view = (messages: Message[], status = "running") => (
  <Transcript
    items={buildTranscript(messages)}
    task={{ ...task, status }}
    childTasks={[]}
    onOpen={vi.fn()}
  />
);

it("shows an inline indeterminate progress bar and replaces it with the completion", () => {
  const start = event("running");
  const result = render(view([start]));
  expect(
    screen.getByRole("progressbar", { name: "正在整理上下文" }),
  ).not.toHaveAttribute("aria-valuenow");
  expect(screen.queryByLabelText("Agent 正在回复")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /执行过程/ }),
  ).not.toBeInTheDocument();
  result.rerender(view([start, event("completed"), event("settled")]));
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.getAllByText("上下文已整理")).toHaveLength(1);
  expect(start.tool?.state).toBe("running"); // normalization cannot mutate persisted input
});

it("ends the indicator on stop, failure, resumed output, and a new Agent turn", async () => {
  const start = event("running");
  const result = render(view([start], "stopping"));
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByText("上下文整理已中断")).toBeVisible(),
  );
  result.rerender(view([start, event("failed")]));
  expect(screen.getByText("上下文整理失败")).toBeVisible();
  result.rerender(view([start, message("继续处理")]));
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.getByText("上下文整理结束")).toBeVisible();
  result.rerender(
    view([start, { ...message("下一轮", "user"), agentKind: "codex" }]),
  );
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByText("上下文整理已中断")).toBeVisible(),
  );
});

it("keeps repeated cycles separate and ignores status resets without an active compaction", () => {
  expect(normalizeCompaction([event("settled")])).toEqual([]);
  const rows = normalizeCompaction([
    event("running"),
    event("running"),
    event("completed"),
    message("继续"),
    event("running"),
    event("settled"),
    event("completed"),
  ]);
  expect(
    rows.filter((m) => m.tool).map((m) => compactionOutcome(m.tool!)),
  ).toEqual(["completed", "completed"]);
  const identified = normalizeCompaction([
    event("running", "a"),
    event("completed", "a"),
    event("running", "b"),
    event("running", "a"),
  ]);
  expect(identified.map((m) => compactionOutcome(m.tool!))).toEqual([
    "completed",
    "running",
  ]);
});

it("isolates subagent events and does not hide the parent progress on background notifications", () => {
  const background = {
    ...event("completed"),
    tool: {
      ...event("completed").tool!,
      name: "task_notification",
      callId: "notification",
    },
  };
  const rows = normalizeCompaction([
    event("running"),
    event("running", "", "child"),
    event("completed", "", "child"),
    background,
  ]);
  expect(compactionOutcome(rows[0].tool!)).toBe("running");
  expect(compactionOutcome(rows[1].tool!)).toBe("completed");
  const finished = normalizeCompaction([
    event("running", "", "child"),
    {
      ...background,
      tool: { ...background.tool, name: "Agent", callId: "child" },
    },
  ]);
  expect(compactionOutcome(finished[0].tool!)).toBe("settled");
});

it("does not turn ordinary conversation text into a progress indicator", () => {
  render(view([message("Compacting conversation", "user")]));
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.getByText("Compacting conversation")).toBeVisible();
});
