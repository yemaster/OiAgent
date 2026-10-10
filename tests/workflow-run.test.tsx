import { expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkflowRunPanel } from "@/components/workspace/WorkflowRun";
import { newWorkflow, type WorkflowRun } from "@/lib/workflows";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({ call: vi.fn() }));
it("requires explicit approval, sends the current revision and prevents double submission", async () => {
  const definition = {
    ...newWorkflow(demoSnapshot.agents, "implement"),
    goal: "Check fixture",
  };
  const run: WorkflowRun = {
    id: "run",
    definition,
    project: "/fixture",
    status: "waiting",
    cursor: 1,
    steps: definition.steps.map((_, i) => ({
      status: i === 0 ? "completed" : i === 1 ? "approval" : "pending",
      taskIds: [],
      output: "",
      attempts: i === 0 ? 1 : 0,
      repairs: 0,
      startedAt: null,
      finishedAt: null,
    })),
    pauseRequested: false,
    error: "等待确认：确认方案",
    feedback: "",
    revision: 5,
    createdAt: "",
    updatedAt: "",
    llmUsage: { input: 0, output: 0, cached: 0, known: false },
  };
  let resolve!: (value: WorkflowRun) => void;
  vi.mocked(call).mockImplementation(async (command) =>
    command === "workflow_run"
      ? run
      : new Promise<WorkflowRun>((done) => {
          resolve = done;
        }),
  );
  const user = userEvent.setup();
  const changed = vi.fn().mockResolvedValue(undefined);
  render(
    <WorkflowRunPanel
      task={{ ...demoSnapshot.tasks[0], id: "run", source: "workflow" }}
      tasks={[]}
      active
      onOpen={vi.fn()}
      onChanged={changed}
    />,
  );
  await screen.findByRole("button", { name: "确认并继续" });
  expect(
    screen.queryByRole("button", { name: "继续执行" }),
  ).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("补充说明（可选）"), "只修改测试文件");
  await user.dblClick(screen.getByRole("button", { name: "确认并继续" }));
  expect(
    vi.mocked(call).mock.calls.filter(([name]) => name === "control_workflow"),
  ).toHaveLength(1);
  expect(call).toHaveBeenCalledWith("control_workflow", {
    id: "run",
    revision: 5,
    action: "approve",
    stepId: definition.steps[1].id,
    feedback: "只修改测试文件",
  });
  await act(async () =>
    resolve({ ...run, status: "running", cursor: 2, revision: 6, error: "" }),
  );
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(
    screen.queryByRole("button", { name: "确认并继续" }),
  ).not.toBeInTheDocument();
});
