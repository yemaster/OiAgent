import { expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkflowInput } from "@/components/workspace/WorkflowInput";
import { call } from "@/lib/api";
import { demoSnapshot } from "@/lib/demo";
vi.mock("@/lib/api", () => ({ call: vi.fn() }));
it("loads captured input on expansion and links to its producing task", async () => {
  const task = demoSnapshot.tasks[0];
  vi.mocked(call).mockResolvedValue({
    evidence: {
      sources: [
        {
          stepId: "one",
          title: "来源步骤",
          taskId: task.id,
          attempt: 2,
          output: "已完成检查",
          truncated: false,
        },
      ],
    },
    artifacts: { files: [] },
  });
  const onOpen = vi.fn();
  render(
    <WorkflowInput
      id="run"
      index={2}
      attempt={1}
      tasks={[task]}
      onOpen={onOpen}
    />,
  );
  expect(call).not.toHaveBeenCalled();
  const user = userEvent.setup();
  await user.click(screen.getByText("上游输入"));
  await user.click(await screen.findByText("来源步骤"));
  await user.click(screen.getByRole("button", { name: "查看任务" }));
  expect(onOpen).toHaveBeenCalledWith(task);
  await waitFor(() =>
    expect(call).toHaveBeenCalledWith("workflow_step_input", {
      id: "run",
      index: 2,
      attempt: 1,
    }),
  );
});
