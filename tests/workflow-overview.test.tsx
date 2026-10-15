import { TooltipProvider } from "@/components/ui/tooltip";
import { beforeEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { WorkflowsPage } from "@/pages/Workflows";
import { useWorkflows } from "@/hooks/useWorkflows";
import { newWorkflow } from "@/lib/workflows";
import { demoSnapshot } from "@/lib/demo";
import type { Task } from "@/lib/types";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({ desktop: false, call: vi.fn() }));
const open = vi.fn(),
  edit = vi.fn(),
  refresh = vi.fn();
const definition = {
  ...newWorkflow(demoSnapshot.agents),
  id: "definition",
  name: "项目检查",
};
const task = (
  id: string,
  status: Task["status"],
  updatedAt: string,
  archived = false,
): Task => ({
  ...demoSnapshot.tasks[0],
  id,
  title: id,
  source: "workflow",
  status,
  updatedAt,
  archived,
  deviceId: undefined,
});
function Page({ tasks }: { tasks: Task[] }) {
  const state = useWorkflows(true);
  return (
    <TooltipProvider>
      <WorkflowsPage
        state={state}
        snapshot={{ ...demoSnapshot, tasks }}
        onEdit={edit}
        onOpen={open}
        onRefresh={refresh}
      />
    </TooltipProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(call).mockResolvedValue({
    definitions: [definition],
    archivedIds: [],
  });
  refresh.mockResolvedValue(undefined);
});
it("shows runs and definitions together, prioritizes active runs and opens a run directly", async () => {
  const tasks = [
    task("旧记录", "completed", "2026-10-12T10:00:00Z"),
    task("新记录", "completed", "2026-10-15T10:00:00Z"),
    task("正在审查", "running", "2026-10-13T10:00:00Z"),
    task("归档记录", "completed", "2026-10-15T10:00:00Z", true),
  ];
  render(<Page tasks={tasks} />);
  expect(
    await screen.findByRole("button", { name: /^项目检查/ }),
  ).toBeVisible();
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  const runs = within(screen.getByRole("region", { name: "运行记录" }));
  const entries = runs
    .getAllByRole("button")
    .filter((button) => !button.getAttribute("aria-label"));
  expect(entries).toHaveLength(3);
  expect(entries[0]).toHaveTextContent("正在审查");
  expect(entries[1]).toHaveTextContent("新记录");
  expect(entries[2]).toHaveTextContent("旧记录");
  fireEvent.click(entries[0]);
  expect(open).toHaveBeenCalledWith(tasks[2]);
  fireEvent.click(screen.getByRole("button", { name: "刷新工作流" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(call).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "已归档" }));
  expect(
    runs.getByRole("checkbox", { name: "选择会话：归档记录" }),
  ).toBeVisible();
  expect(
    runs.queryByRole("button", { name: /正在审查/ }),
  ).not.toBeInTheDocument();
});
it("bounds the recent list and resets it when searching, without hiding active runs", async () => {
  const tasks = Array.from({ length: 25 }, (_, i) =>
    task(
      `检查-${i}`,
      "completed",
      `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
    ),
  );
  render(<Page tasks={tasks} />);
  const runs = within(screen.getByRole("region", { name: "运行记录" }));
  expect(
    runs.queryByRole("button", { name: /^检查-0已完成/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(runs.getByRole("button", { name: "加载更多" }));
  expect(runs.getByRole("button", { name: /^检查-0已完成/ })).toBeVisible();
  fireEvent.change(screen.getByRole("textbox", { name: "搜索工作流" }), {
    target: { value: "检查-24" },
  });
  expect(runs.getByRole("button", { name: /^检查-24已完成/ })).toBeVisible();
  expect(
    runs.queryByRole("button", { name: /^检查-0已完成/ }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "搜索工作流" }), {
    target: { value: "不存在" },
  });
  expect(runs.getByText("没有匹配的运行记录")).toBeVisible();
});
