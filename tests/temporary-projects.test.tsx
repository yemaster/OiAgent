import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewTaskPage } from "@/pages/NewTask";
import { TemporaryProjectBar } from "@/components/workspace/TemporaryProjectBar";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({
  desktop: true,
  call: vi.fn(),
  pickDirectory: vi.fn(),
}));
const request = vi.mocked(call);
const allocated = {
  id: "temp-id",
  path: "/app/temporary-projects/test",
  createdAt: "2026-10-09T00:00:00Z",
  status: "active" as const,
  cleanupAfter: null,
};
beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (command) =>
    command === "create_temporary_project" ? allocated : demoSnapshot.tasks[0],
  );
});
it("allocates only on submit and passes the allocated directory to the task", async () => {
  const user = userEvent.setup();
  const created = vi.fn();
  render(
    <NewTaskPage
      snapshot={demoSnapshot}
      project="all"
      onCreated={created}
      onSettings={vi.fn()}
      onAgents={vi.fn()}
    />,
  );
  expect(screen.getByRole("tab", { name: "临时项目" })).toHaveAttribute(
    "data-state",
    "active",
  );
  expect(request).not.toHaveBeenCalledWith("create_temporary_project");
  await user.type(screen.getByLabelText("任务内容"), "临时分析");
  await user.click(screen.getByRole("button", { name: "启动任务" }));
  await waitFor(() => expect(created).toHaveBeenCalled());
  expect(request).toHaveBeenCalledWith("create_task", {
    input: expect.objectContaining({
      project: allocated.path,
      resumeSession: null,
    }),
  });
});
it("reuses allocated storage when task creation fails and the user retries", async () => {
  let attempts = 0;
  request.mockImplementation(async (command) => {
    if (command === "create_temporary_project") return allocated;
    if (command === "create_task" && attempts++ === 0)
      throw new Error("launch failed");
    return demoSnapshot.tasks[0];
  });
  const user = userEvent.setup();
  const created = vi.fn();
  render(
    <NewTaskPage
      snapshot={demoSnapshot}
      project="all"
      onCreated={created}
      onSettings={vi.fn()}
      onAgents={vi.fn()}
    />,
  );
  await user.type(screen.getByLabelText("任务内容"), "retry");
  await user.click(screen.getByRole("button", { name: "启动任务" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "启动任务" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "启动任务" }));
  await waitFor(() => expect(created).toHaveBeenCalled());
  expect(
    request.mock.calls.filter(
      ([command]) => command === "create_temporary_project",
    ),
  ).toHaveLength(1);
});
it("uses temporary projects in terminal mode without inheriting the old directory", async () => {
  const user = userEvent.setup();
  render(
    <NewTaskPage
      snapshot={demoSnapshot}
      project={demoSnapshot.projects[0]}
      onCreated={vi.fn()}
      onSettings={vi.fn()}
      onAgents={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("tab", { name: "临时项目" }));
  await user.click(screen.getByRole("button", { name: "运行方式" }));
  await user.click(screen.getByRole("menuitemradio", { name: /交互终端/ }));
  await user.click(screen.getByRole("button", { name: "打开终端" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("terminal_start", {
      project: allocated.path,
      command: "",
    }),
  );
});
it("requires explicit cleanup confirmation and permits keeping an active project", async () => {
  const user = userEvent.setup();
  const cleanup = vi.fn().mockResolvedValue(undefined);
  const changed = vi.fn().mockResolvedValue(undefined);
  render(
    <TemporaryProjectBar
      project={allocated}
      onChanged={changed}
      onCleanup={cleanup}
    />,
  );
  await user.click(screen.getByRole("button", { name: "清理临时文件" }));
  expect(cleanup).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(cleanup).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "保留项目" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("keep_temporary_project", {
      id: allocated.id,
    }),
  );
  await user.click(screen.getByRole("button", { name: "清理临时文件" }));
  await user.click(screen.getByRole("button", { name: "删除文件并归档" }));
  await waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
});
