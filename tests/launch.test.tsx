import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewTaskPage } from "@/pages/NewTask";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({
  desktop: true,
  call: vi.fn(),
  pickDirectory: vi.fn(),
}));
const mockedCall = vi.mocked(call);
const task = demoSnapshot.tasks[0];
beforeEach(() => {
  localStorage.clear();
  mockedCall.mockReset();
  mockedCall.mockImplementation(async (command) => {
    if (command === "llm_status") return { configured: false };
    if (command === "parse_command")
      return ["my-agent", ["--prompt", "{prompt}"]];
    if (command === "save_agent") return { id: "custom-1" };
    return task;
  });
});
function mount(supervisor = false) {
  const onCreated = vi.fn();
  render(
    <NewTaskPage
      snapshot={demoSnapshot}
      project={demoSnapshot.projects[0]}
      onCreated={onCreated}
      onSettings={vi.fn()}
      onAgents={vi.fn()}
      supervisor={supervisor}
    />,
  );
  return onCreated;
}
describe("progressive task creation", () => {
  it("keeps optional fields collapsed and submits a regular task with its permissions", async () => {
    const user = userEvent.setup();
    const created = mount();
    expect(
      screen.getByRole("textbox", { name: "模型（可选）" }),
    ).not.toBeVisible();
    await user.type(
      screen.getByRole("textbox", { name: "任务内容" }),
      "检查登录错误处理",
    );
    await user.click(screen.getByRole("button", { name: "启动任务" }));
    await waitFor(() => expect(created).toHaveBeenCalledWith(task));
    expect(mockedCall).toHaveBeenCalledWith("create_task", {
      input: expect.objectContaining({
        prompt: "检查登录错误处理",
        project: demoSnapshot.projects[0],
        permission: "read-only",
        queued: false,
        resumeSession: null,
      }),
    });
  });
  it("reveals advanced options without discarding the prompt", async () => {
    const user = userEvent.setup();
    mount();
    await user.type(
      screen.getByRole("textbox", { name: "任务内容" }),
      "分析项目",
    );
    await user.click(screen.getByText("更多设置"));
    await user.type(
      screen.getByRole("textbox", { name: "任务名称（可选）" }),
      "代码分析",
    );
    await user.type(
      screen.getByRole("textbox", { name: "模型（可选）" }),
      "custom-model",
    );
    await user.click(screen.getByRole("button", { name: "保存为待启动任务" }));
    expect(mockedCall).toHaveBeenCalledWith("create_task", {
      input: expect.objectContaining({
        title: "代码分析",
        model: "custom-model",
        prompt: "分析项目",
        queued: true,
      }),
    });
  });
  it("supports command mode and an interactive shell from the mode menu", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "运行方式" }));
    await user.click(screen.getByRole("menuitemradio", { name: /自定义命令/ }));
    expect(
      screen.queryByRole("combobox", { name: "执行权限" }),
    ).not.toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "启动命令" }),
      "my-agent",
    );
    await user.type(
      screen.getByRole("textbox", { name: "任务内容" }),
      "检查文件",
    );
    await user.click(screen.getByRole("button", { name: "启动任务" }));
    await waitFor(() =>
      expect(mockedCall).toHaveBeenCalledWith("create_task", {
        input: expect.objectContaining({
          agentId: "custom-1",
          prompt: "检查文件",
        }),
      }),
    );
    await user.click(screen.getByRole("button", { name: "运行方式" }));
    await user.click(screen.getByRole("menuitemradio", { name: /交互终端/ }));
    await user.clear(screen.getByRole("textbox", { name: "启动命令（可选）" }));
    await user.click(screen.getByRole("button", { name: "打开终端" }));
    await waitFor(() =>
      expect(mockedCall).toHaveBeenCalledWith("terminal_start", {
        project: demoSnapshot.projects[0],
        command: "",
      }),
    );
  });
  it("explains the API prerequisite and prevents an unconfigured supervisor launch", async () => {
    const user = userEvent.setup();
    mount(true);
    await screen.findByText("开始前，需要连接一个 LLM API");
    await user.type(
      screen.getByRole("textbox", { name: "任务目标" }),
      "检查并完善项目",
    );
    expect(screen.getByRole("button", { name: "启动自动派发" })).toBeDisabled();
    expect(mockedCall).not.toHaveBeenCalledWith(
      "start_supervisor",
      expect.anything(),
    );
  });
  it("dispatches a configured supervisor with the selected task limit", async () => {
    mockedCall.mockImplementation(async (command) =>
      command === "llm_status" ? { configured: true } : task,
    );
    const user = userEvent.setup();
    mount(true);
    await screen.findByText("LLM API 已配置");
    await user.type(
      screen.getByRole("textbox", { name: "任务目标" }),
      "检查并完善项目",
    );
    await user.click(screen.getByRole("button", { name: "启动自动派发" }));
    await waitFor(() =>
      expect(mockedCall).toHaveBeenCalledWith("start_supervisor", {
        prompt: "检查并完善项目",
        project: demoSnapshot.projects[0],
        permission: "read-only",
        maxTasks: 4,
      }),
    );
  });
});
