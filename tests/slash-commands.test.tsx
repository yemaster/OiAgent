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

it.each([
  ["new", "running", undefined],
  ["clear", "completed", undefined],
  ["clear", "running", "peer"],
])(
  "handles /%s locally for a %s conversation on %s",
  async (name, status, deviceId) => {
    const task = {
      ...demoSnapshot.tasks[0],
      source: "managed",
      status,
      deviceId,
    };
    vi.mocked(call).mockClear();
    vi.mocked(call).mockImplementation(async (command) => {
      if (command === "get_detail") return { task, messages: [], log: "" };
      if (command === "task_approvals") return [];
      if (command === "task_commands")
        return {
          commands: [{ name: "clear", description: "原生命令" }],
          models: [],
        };
      return null;
    });
    const onNewTask = vi.fn();
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
          onNewTask={onNewTask}
          onChanged={vi.fn().mockResolvedValue(undefined)}
        />
      </TooltipProvider>,
    );
    const user = userEvent.setup();
    const input = await screen.findByRole("textbox", { name: "继续对话" });
    await user.type(input, `/${name}`);
    expect(
      screen.getAllByRole("button", { name: new RegExp(`^/${name}`) }),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "发送方式" }),
    ).not.toBeInTheDocument();
    await user.type(input, " extra{Control>}{Enter}{/Control}");
    expect(onNewTask).not.toHaveBeenCalled();
    expect(input).toHaveValue(`/${name} extra`);
    await user.clear(input);
    await user.type(input, `/${name}`);
    await user.click(
      screen.getByRole("button", { name: "新建聊天", exact: true }),
    );
    expect(onNewTask).toHaveBeenCalledOnce();
    expect(input).toHaveValue("");
    for (const command of [
      "queue_message",
      "stop_task",
      "create_task",
      "start_task",
    ])
      expect(call).not.toHaveBeenCalledWith(command, expect.anything());
  },
);
