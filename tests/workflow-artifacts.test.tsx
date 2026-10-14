import { expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkflowRunPanel } from "@/components/workspace/WorkflowRun";
import { newWorkflow, newStep, type WorkflowRun } from "@/lib/workflows";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({ call: vi.fn() }));

function fixture(): WorkflowRun {
  const steps = [
    newStep("", "agent"),
    newStep("", "agent"),
    newStep("", "review"),
  ];
  steps.forEach((step, i) => {
    step.title = ["资料分析", "汇总报告", "验收"][i];
  });
  return {
    id: "workflow",
    project: "/project",
    status: "waiting",
    cursor: 2,
    definition: {
      ...newWorkflow(demoSnapshot.agents),
      steps,
      edges: steps.slice(0, 2).map((step, i) => ({
        id: `edge-${i}`,
        source: step.id,
        target: steps[2].id,
      })),
    },
    steps: steps.map((_, i) => ({
      status: i === 2 ? "failed" : "completed",
      taskIds: i === 2 ? [] : [`child-${i}`],
      output: "验收不通过",
      attempts: 1,
      repairs: 0,
      startedAt: null,
      finishedAt: null,
    })),
    pauseRequested: false,
    error: "验收未通过",
    feedback: "",
    revision: 5,
    createdAt: "",
    updatedAt: "",
    llmUsage: { input: 0, output: 0, cached: 0, known: false },
  };
}
function props(run: WorkflowRun) {
  return {
    task: { ...demoSnapshot.tasks[0], id: run.id, source: "workflow" },
    tasks: [0, 1].map((i) => ({
      ...demoSnapshot.tasks[0],
      id: `child-${i}`,
      parentId: run.id,
    })),
    active: true,
    onOpen: vi.fn(),
    onChanged: vi.fn().mockResolvedValue(undefined),
  };
}
it("opens referenced files on demand, previews content, and opens the editor", async () => {
  const run = fixture();
  const file = {
    path: "/project/summary.md",
    project: "/project",
    relativePath: "summary.md",
    stepIds: [run.definition.steps[1].id],
    size: 32,
    error: null,
  };
  vi.mocked(call).mockClear();
  vi.mocked(call).mockImplementation(async (command) => {
    if (command === "workflow_run") return run;
    if (command === "workflow_artifacts")
      return { files: [file], truncated: false };
    if (command === "workflow_artifact")
      return {
        content: "# 汇总正文\n\n结论与依据对应。",
        truncated: false,
        revision: "1",
      };
    return null;
  });
  const openFile = vi.fn();
  render(<WorkflowRunPanel {...props(run)} onOpenFile={openFile} />);
  const user = userEvent.setup();
  await screen.findByRole("tab", { name: "产物" });
  expect(call).not.toHaveBeenCalledWith(
    "workflow_artifacts",
    expect.anything(),
  );
  await user.click(screen.getByRole("tab", { name: "产物" }));
  const panel = await screen.findByRole("region", { name: "工作流产物" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    await within(panel).findByRole("heading", { name: "汇总正文" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "展开产物面板" }));
  expect(
    screen.getByRole("button", { name: "收起产物面板" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "步骤", exact: true }));
  expect(
    screen.getByRole("button", { name: "返工并验收" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "产物" }));
  expect(
    within(panel).getByRole("button", { name: /summary.md/ }),
  ).toHaveAttribute("aria-current", "true");
  await user.click(within(panel).getByRole("button", { name: "编辑" }));
  expect(openFile).toHaveBeenCalledWith("/project", "summary.md");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});
it("offers rework for join reviews and sends the chosen source, report context and revision", async () => {
  const run = fixture();
  vi.mocked(call).mockClear();
  vi.mocked(call).mockImplementation(async (command) =>
    command === "workflow_run"
      ? run
      : {
          ...run,
          status: "running",
          revision: 6,
          steps: run.steps.map((step) => ({ ...step, status: "pending" })),
        },
  );
  const viewProps = props(run);
  render(<WorkflowRunPanel {...viewProps} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "继续对话" }));
  expect(viewProps.onOpen).toHaveBeenCalledWith(viewProps.tasks[1]);
  await user.click(screen.getByRole("combobox", { name: "返工步骤" }));
  await user.click(await screen.findByRole("option", { name: "资料分析" }));
  await user.type(screen.getByLabelText("补充说明（可选）"), "补齐引用依据");
  await user.click(screen.getByRole("button", { name: "返工并验收" }));
  expect(call).toHaveBeenCalledWith(
    "rework_workflow",
    expect.objectContaining({
      id: run.id,
      revision: 5,
      reviewId: run.definition.steps[2].id,
      sourceId: run.definition.steps[0].id,
      feedback: "补齐引用依据",
    }),
  );
});
