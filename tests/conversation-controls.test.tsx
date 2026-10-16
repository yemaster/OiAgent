import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DetailPage } from "@/pages/Detail";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  call: vi.fn(),
  desktop: true,
  exportText: vi.fn(),
}));
const claude = {
  ...demoSnapshot.agents[0],
  id: "claude",
  kind: "claude",
  available: true,
};
const task = {
  ...demoSnapshot.tasks[0],
  id: "live",
  source: "managed",
  status: "running",
  agentId: claude.id,
  agentKind: "claude",
  permission: "default",
};
beforeEach(() => vi.clearAllMocks());
function renderDetail() {
  render(
    <TooltipProvider>
      <DetailPage
        task={task}
        tasks={[task]}
        agents={[claude]}
        profiles={[]}
        onBack={vi.fn()}
        onOpen={vi.fn()}
        onChanged={async () => {}}
        onRetry={vi.fn()}
      />
    </TooltipProvider>,
  );
}
it("waits for a mode acknowledgement while leaving stop available", async () => {
  const user = userEvent.setup();
  let acknowledge!: (value: unknown) => void;
  vi.mocked(call).mockImplementation(async (command) => {
    if (command === "set_task_permission")
      return new Promise((resolve) => {
        acknowledge = resolve;
      });
    if (command === "task_approvals") return [];
    return { task, messages: [], log: "" };
  });
  renderDetail();
  const selector = screen.getByRole("combobox", { name: "当前执行权限" });
  await user.click(selector);
  await user.click(screen.getByRole("option", { name: "Auto · 自动审查操作" }));
  expect(call).toHaveBeenCalledWith("set_task_permission", {
    id: "live",
    permission: "auto",
  });
  expect(selector).toHaveTextContent("Default");
  expect(selector).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "停止任务", exact: true }),
  ).toBeEnabled();
  await act(async () => acknowledge({ ...task, permission: "auto" }));
  await waitFor(() => expect(selector).toHaveTextContent("Auto"));
});
it("keeps the current mode on rejection instead of showing an unapplied selection", async () => {
  const user = userEvent.setup();
  vi.mocked(call).mockImplementation(async (command) => {
    if (command === "set_task_permission") throw new Error("unsupported mode");
    if (command === "task_approvals") return [];
    return { task, messages: [], log: "" };
  });
  renderDetail();
  const selector = screen.getByRole("combobox", { name: "当前执行权限" });
  await user.click(selector);
  await user.click(screen.getByRole("option", { name: "Auto · 自动审查操作" }));
  await waitFor(() => expect(selector).toBeEnabled());
  expect(selector).toHaveTextContent("Default");
});

it("uses the stop reply immediately and ignores stale running polls before sending again", async () => {
  const user = userEvent.setup();
  const stopped = {
    ...task,
    status: "cancelled",
    updatedAt: "2030-01-01T00:00:01Z",
  };
  const resumed = { ...task, updatedAt: "2030-01-01T00:00:02Z" };
  vi.mocked(call).mockImplementation(async (command) => {
    if (command === "stop_task") return stopped;
    if (command === "queue_message") return resumed;
    if (command === "task_approvals") return [];
    if (command === "task_artifacts") return { files: [], truncated: false };
    // Both the parent snapshot and delayed detail replies still say running.
    return { task, messages: [], log: "" };
  });
  renderDetail();
  await user.click(
    screen.getByRole("button", { name: "停止任务", exact: true }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "发送消息", exact: true }),
    ).toBeVisible(),
  );
  expect(
    screen.queryByRole("button", { name: "发送方式" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "当前执行权限" }),
  ).not.toBeInTheDocument();
  await user.type(
    screen.getByRole("textbox", { name: "继续对话" }),
    "继续处理",
  );
  await user.click(
    screen.getByRole("button", { name: "发送消息", exact: true }),
  );
  expect(call).toHaveBeenCalledWith(
    "queue_message",
    expect.objectContaining({ text: "继续处理", immediate: false }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "添加到消息队列" }),
    ).toBeVisible(),
  );
});

it("defaults to queuing and offers explicit interruption for a running task", async () => {
  const user = userEvent.setup();
  vi.mocked(call).mockImplementation(async (command) => {
    if (command === "task_approvals") return [];
    if (command === "task_artifacts") return { files: [], truncated: false };
    if (command === "queue_message") return task;
    return { task, messages: [], log: "" };
  });
  renderDetail();
  await user.type(
    screen.getByRole("textbox", { name: "继续对话" }),
    "补充要求",
  );
  await user.click(screen.getByRole("button", { name: "添加到消息队列" }));
  expect(call).toHaveBeenCalledWith(
    "queue_message",
    expect.objectContaining({ text: "补充要求", immediate: false }),
  );
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "继续对话" })).toBeEnabled(),
  );
  await user.type(
    screen.getByRole("textbox", { name: "继续对话" }),
    "现在处理",
  );
  await user.click(screen.getByRole("button", { name: "发送方式" }));
  await user.click(screen.getByRole("menuitem", { name: /立即发送/ }));
  expect(call).toHaveBeenCalledWith(
    "queue_message",
    expect.objectContaining({ text: "现在处理", immediate: true }),
  );
});
