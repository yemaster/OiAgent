import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { TaskOverview } from "@/components/workspace/TaskOverview";
import { demoSnapshot } from "@/lib/demo";
import type { TranscriptItem } from "@/lib/transcript";

it("shows the latest owning Agent plan without merging old or subagent plans", () => {
  const plan = (text: string, completed: boolean): TranscriptItem => ({
    kind: "tool",
    key: text,
    timestamp: "",
    nested: [],
    tool: {
      name: "update_plan",
      callId: text,
      input: {
        plan: [{ step: text, status: completed ? "completed" : "in_progress" }],
      },
      output: null,
      state: "completed",
    },
  });
  const delegated: TranscriptItem = {
    kind: "tool",
    key: "agent",
    timestamp: "",
    tool: {
      name: "spawn_agent",
      callId: "agent",
      input: {},
      output: null,
      state: "completed",
    },
    nested: [plan("子任务计划", false)],
  };
  render(
    <TaskOverview
      task={demoSnapshot.tasks[0]}
      timeline={[plan("旧计划", false), plan("最新计划", true), delegated]}
    >
      <button>产物</button>
    </TaskOverview>,
  );
  expect(screen.getByText("最新计划")).toHaveClass("line-through");
  expect(screen.getByText("1/1")).toBeVisible();
  expect(
    screen.getByRole("progressbar", { name: "计划完成进度" }),
  ).toHaveAttribute("aria-valuenow", "1");
  expect(screen.queryByText("旧计划")).not.toBeInTheDocument();
  expect(screen.queryByText("子任务计划")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "产物" })).toBeVisible();
});
it("does not invent progress when the Agent has not provided a plan", () => {
  render(
    <TaskOverview task={demoSnapshot.tasks[0]} timeline={[]}>
      {null}
    </TaskOverview>,
  );
  expect(screen.queryByText("计划")).not.toBeInTheDocument();
  expect(screen.getByText(demoSnapshot.tasks[0].title)).toBeVisible();
});
