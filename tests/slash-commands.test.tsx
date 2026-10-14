import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DetailPage } from "@/pages/Detail";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
import { slashCommand } from "@/lib/slashCommands";
vi.mock("@/lib/api", () => ({ call: vi.fn() }));
it("distinguishes commands, arguments and absolute file paths", () => {
  expect(slashCommand("/model example-model")).toEqual({
    name: "model",
    argument: "example-model",
  });
  expect(slashCommand("/my-plugin:review check changes")).toEqual({
    name: "my-plugin:review",
    argument: "check changes",
  });
  expect(slashCommand("/Users/me/project/file.rs")).toBeNull();
});
it("discovers native commands and sends model controls without creating a model prompt", async () => {
  const task = {
    ...demoSnapshot.tasks[0],
    source: "managed",
    status: "running",
  };
  vi.mocked(call).mockImplementation(async (command, args) => {
    if (command === "get_detail") return { task, messages: [], log: "" };
    if (command === "task_approvals") return [];
    if (command === "task_commands")
      return {
        commands: [{ name: "new-cli-command", description: "CLI 返回的命令" }],
        models: [],
      };
    if (command === "set_task_model") return { ...task, model: args?.model };
    return null;
  });
  render(
    <TooltipProvider>
      <DetailPage
        task={task}
        tasks={[]}
        agents={demoSnapshot.agents}
        profiles={[]}
        onBack={vi.fn()}
        onRetry={vi.fn()}
        onOpen={vi.fn()}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />
    </TooltipProvider>,
  );
  const user = userEvent.setup();
  const input = await screen.findByRole("textbox", { name: "继续对话" });
  await user.type(input, "/");
  await screen.findByRole("button", { name: /new-cli-command/ });
  await user.type(input, "model test-model{Control>}{Enter}{/Control}");
  await waitFor(() =>
    expect(call).toHaveBeenCalledWith("set_task_model", {
      id: task.id,
      model: "test-model",
    }),
  );
  expect(call).not.toHaveBeenCalledWith("queue_message", expect.anything());
  await user.type(input, "/unknown-command{Control>}{Enter}{/Control}");
  expect(call).not.toHaveBeenCalledWith("queue_message", expect.anything());
  expect(input).toHaveValue("/unknown-command");
});
