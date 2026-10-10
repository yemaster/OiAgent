import { useState } from "react";
import { expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkflowEditorPage } from "@/pages/WorkflowEditor";
import { TooltipProvider } from "@/components/ui/tooltip";
import { newWorkflow, layoutGraph, type WorkflowEditor } from "@/lib/workflows";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  call: vi.fn(),
  desktop: true,
  pickDirectory: vi.fn(),
}));

it("generates an editable draft without executing and starts only the revised plan", async () => {
  const generated = {
    ...newWorkflow(demoSnapshot.agents, "implement"),
    goal: "为登录接口补上测试",
    name: "登录测试",
  };
  const created = vi.fn();
  vi.mocked(call).mockImplementation(async (command) => {
    if (command === "generate_workflow") return generated;
    if (command === "start_workflow") return demoSnapshot.tasks[0];
    throw new Error(`Unexpected command: ${command}`);
  });
  function Editor() {
    const [editor, setEditor] = useState<WorkflowEditor>({
      sessionId: "draft",
      definition: { ...newWorkflow(demoSnapshot.agents), goal: generated.goal },
      project: "/fixture",
    });
    return (
      <TooltipProvider>
        <WorkflowEditorPage
          editor={editor}
          snapshot={demoSnapshot}
          onChange={(id, patch) => {
            if (id === editor.sessionId)
              setEditor((old) => ({ ...old, ...patch }));
          }}
          onSaved={vi.fn()}
          onBack={vi.fn()}
          onCreated={created}
          onSettings={vi.fn()}
        />
      </TooltipProvider>
    );
  }
  const user = userEvent.setup();
  render(<Editor />);
  await user.click(screen.getByRole("button", { name: "生成计划" }));
  await waitFor(() =>
    expect(screen.getByLabelText("名称", { exact: true })).toHaveValue(
      "登录测试",
    ),
  );
  expect(call).toHaveBeenCalledExactlyOnceWith("generate_workflow", {
    goal: generated.goal,
    name: "",
    defaultAgentId: generated.defaultAgentId,
  });
  expect(created).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText("任务内容"));
  await user.type(
    screen.getByLabelText("任务内容"),
    "只检查登录路由，保留现有接口",
  );
  await user.click(screen.getByRole("tab", { name: "执行", exact: true }));
  const timeout = screen.getByLabelText("执行时限（分钟，可选）");
  expect(timeout).toHaveValue(null);
  await user.type(timeout, "45");
  await user.clear(timeout);
  expect(timeout).toHaveValue(null);
  await user.type(timeout, "0");
  await user.click(screen.getByRole("button", { name: "启动", exact: true }));
  expect(screen.getByRole("alert")).toHaveTextContent("执行时限需为正整数");
  expect(created).not.toHaveBeenCalled();
  await user.clear(timeout);
  await user.type(timeout, "90");
  await user.click(screen.getByRole("button", { name: "启动", exact: true }));
  await waitFor(() => expect(created).toHaveBeenCalledOnce());
  expect(call).toHaveBeenLastCalledWith("start_workflow", {
    project: "/fixture",
    definition: {
      ...layoutGraph(generated),
      steps: [
        {
          ...layoutGraph(generated).steps[0],
          prompt: "只检查登录路由，保留现有接口",
          executionTimeoutMinutes: 90,
        },
        ...layoutGraph(generated).steps.slice(1),
      ],
    },
  });
});
