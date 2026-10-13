import { expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkflowRunPanel } from "@/components/workspace/WorkflowRun";
import { newWorkflow, type WorkflowRun } from "@/lib/workflows";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({ call: vi.fn() }));

it.each([
  ["cancelled", "从断点继续", "resume"],
  ["waiting", "继续当前步骤", "continue"],
  ["waiting", "重新执行", "retry"],
] as const)(
  "offers the correct recovery action for %s: %s",
  async (status, label, action) => {
    vi.mocked(call).mockClear();
    const definition = newWorkflow(demoSnapshot.agents);
    const run: WorkflowRun = {
      id: "interrupted-run",
      definition,
      project: "/fixture",
      status,
      cursor: 0,
      steps: definition.steps.map(() => ({
        status: status === "cancelled" ? "cancelled" : "failed",
        taskIds: ["previous-attempt"],
        output: "Partial result",
        attempts: 1,
        repairs: 0,
        startedAt: null,
        finishedAt: null,
      })),
      pauseRequested: false,
      error: "执行已中断",
      feedback: "",
      revision: 7,
      createdAt: "",
      updatedAt: "",
      llmUsage: { input: 0, output: 0, cached: 0, known: false },
    };
    vi.mocked(call).mockImplementation(async (command) =>
      command === "workflow_run"
        ? run
        : {
            ...run,
            status: "running",
            revision: 8,
            steps: run.steps.map((step) => ({ ...step, status: "running" })),
          },
    );
    render(
      <WorkflowRunPanel
        task={{ ...demoSnapshot.tasks[0], id: run.id, source: "workflow" }}
        tasks={[]}
        active
        onOpen={vi.fn()}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: label }));
    expect(call).toHaveBeenCalledWith("control_workflow", {
      id: run.id,
      revision: 7,
      action,
      stepId: definition.steps[0].id,
      feedback: "",
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: label }),
      ).not.toBeInTheDocument(),
    );
  },
);

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
  // Inspecting a completed node must not replace the pending approval with
  // a misleading Resume action or send approval to the inspected node.
  fireEvent.click(await screen.findByLabelText("分析需求，已完成"));
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
    resolve({
      ...run,
      status: "running",
      cursor: 2,
      revision: 6,
      error: "",
      steps: run.steps.map((step, index) =>
        index === 1
          ? { ...step, status: "completed" }
          : index === 2
            ? { ...step, status: "running" }
            : step,
      ),
    }),
  );
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(
    screen.queryByRole("button", { name: "确认并继续" }),
  ).not.toBeInTheDocument();
});

it("surfaces a waiting Agent request and removes it after the Agent resumes", async () => {
  const definition = {
    ...newWorkflow(demoSnapshot.agents),
    goal: "Check fixture",
  };
  const child = {
    ...demoSnapshot.tasks[0],
    id: "child",
    parentId: "run",
    status: "waiting" as const,
    preview: "等待操作：Bash",
  };
  const run: WorkflowRun = {
    id: "run",
    definition,
    project: "/fixture",
    status: "running",
    cursor: 0,
    steps: [
      {
        status: "running",
        taskIds: [child.id],
        output: "",
        attempts: 1,
        repairs: 0,
        startedAt: null,
        finishedAt: null,
      },
    ],
    pauseRequested: false,
    error: "",
    feedback: "",
    revision: 3,
    createdAt: "",
    updatedAt: "",
    llmUsage: { input: 0, output: 0, cached: 0, known: false },
  };
  vi.mocked(call).mockResolvedValue(run);
  const onOpen = vi.fn();
  const props = {
    task: { ...demoSnapshot.tasks[0], id: "run", source: "workflow" },
    active: true,
    onOpen,
    onChanged: vi.fn().mockResolvedValue(undefined),
  };
  const view = render(<WorkflowRunPanel {...props} tasks={[child]} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "处理请求" }));
  expect(onOpen).toHaveBeenCalledWith(child);
  expect(
    within(screen.getByRole("region", { name: "Agent 等待操作" })).getByText(
      "等待操作：Bash",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "重试当前步骤" }),
  ).not.toBeInTheDocument();
  view.rerender(
    <WorkflowRunPanel {...props} tasks={[{ ...child, status: "running" }]} />,
  );
  expect(
    screen.queryByRole("button", { name: "处理请求" }),
  ).not.toBeInTheDocument();
  const updated = { ...child, status: "running", preview: "正在检查登录接口" };
  view.rerender(<WorkflowRunPanel {...props} tasks={[updated]} />);
  const records = screen.getByLabelText("节点执行记录");
  expect(within(records).getByText("正在检查登录接口")).toBeVisible();
  expect(within(records).getByText("进行中")).toBeVisible();
  await user.click(within(records).getByRole("button"));
  expect(onOpen).toHaveBeenLastCalledWith(updated);
  const canvas = await screen.findByLabelText("工作流画布");
  expect(within(canvas).getByText("正在检查登录接口")).toBeInTheDocument();
});
