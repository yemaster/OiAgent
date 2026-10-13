import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { TasksPage } from "@/pages/Tasks";
import { demoSnapshot } from "@/lib/demo";

const props = {
  snapshot: {
    ...demoSnapshot,
    tasks: [
      ...demoSnapshot.tasks,
      {
        ...demoSnapshot.tasks[4],
        id: "archived-copy",
        title: "已归档测试任务",
        archived: true,
      },
    ],
  },
  project: "all",
  onOpen: vi.fn(),
  onNew: vi.fn(),
  onProject: vi.fn(),
  onHistory: vi.fn(),
  onStats: vi.fn(),
};

it("replaces shortcuts with the selected project's history and restores them when cleared", () => {
  const view = render(<TasksPage {...props} />);
  expect(
    screen.getByRole("navigation", { name: "任务快捷入口" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("region", { name: "历史任务" }),
  ).not.toBeInTheDocument();

  view.rerender(<TasksPage {...props} project={demoSnapshot.projects[0]} />);
  expect(
    screen.queryByRole("navigation", { name: "任务快捷入口" }),
  ).not.toBeInTheDocument();
  const history = within(screen.getByRole("region", { name: "历史任务" }));
  expect(history.getByText("实现项目目录筛选")).toBeVisible();
  expect(history.queryByText("修复移动端导航溢出")).not.toBeInTheDocument();
  expect(history.queryByText("已归档测试任务")).not.toBeInTheDocument();
  expect(history.queryByText("完善任务详情的对话体验")).not.toBeInTheDocument();

  view.rerender(<TasksPage {...props} />);
  expect(
    screen.getByRole("navigation", { name: "任务快捷入口" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("region", { name: "历史任务" }),
  ).not.toBeInTheDocument();
});

it("applies search and Agent filters to historical tasks without leaving the task page", async () => {
  const user = userEvent.setup();
  render(<TasksPage {...props} />);
  const search = screen.getByRole("textbox", { name: "搜索任务" });
  await user.type(search, "目录筛选");
  expect(
    screen.queryByRole("navigation", { name: "任务快捷入口" }),
  ).not.toBeInTheDocument();
  expect(
    within(screen.getByRole("region", { name: "历史任务" })).getByText(
      "实现项目目录筛选",
    ),
  ).toBeVisible();

  await user.click(screen.getByRole("button", { name: "筛选", exact: true }));
  await user.click(screen.getByRole("combobox", { name: "筛选 Agent" }));
  await user.click(screen.getByRole("option", { name: "Codex" }));
  await user.click(screen.getByRole("button", { name: "完成" }));
  expect(screen.getByText("暂无符合条件的历史任务")).toBeVisible();
  await user.clear(search);
  expect(
    within(screen.getByRole("region", { name: "历史任务" })).getByText(
      "修复移动端导航溢出",
    ),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "清除筛选" }));
  expect(
    screen.getByRole("navigation", { name: "任务快捷入口" }),
  ).toBeVisible();
});
