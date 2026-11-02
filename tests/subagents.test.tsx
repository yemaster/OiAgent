import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import {
  SubagentList,
  SubagentSummary,
} from "@/components/workspace/Subagents";
import { TooltipProvider } from "@/components/ui/tooltip";
import { demoSnapshot } from "@/lib/demo";
import type { Task } from "@/lib/types";
import { SubagentCard } from "@/components/workspace/Transcript";

function child(index: number, patch: Partial<Task> = {}): Task {
  return {
    ...demoSnapshot.tasks[0],
    id: `child-${index}`,
    subagentName: `分工 ${index}`,
    title: `检查文件 ${index}`,
    preview: `检查结果 ${index}`,
    parentId: "parent",
    createdAt: new Date(Date.UTC(2026, 10, 2, 0, 0, index)).toISOString(),
    status: "completed",
    usage: { input: 0, output: 0, cached: 0, known: false },
    ...patch,
  };
}

it("displays and searches the human explanation in details and conversation child cards", async () => {
  const task = child(0, {
    preview: JSON.stringify({
      risk_level: "low",
      outcome: "allow",
      rationale: "只读取项目文件，没有修改操作。",
    }),
  });
  const view = render(<SubagentList tasks={[task]} onOpen={vi.fn()} />);
  expect(screen.getByText("只读取项目文件，没有修改操作。")).toBeVisible();
  expect(screen.queryByText(/risk_level|rationale/)).not.toBeInTheDocument();
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "搜索子 Agent" }),
    "只读取项目",
  );
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  await user.clear(screen.getByRole("textbox", { name: "搜索子 Agent" }));
  await user.type(
    screen.getByRole("textbox", { name: "搜索子 Agent" }),
    "risk_level",
  );
  expect(screen.getByText("没有匹配的子 Agent")).toBeVisible();
  view.unmount();
  render(<SubagentCard task={task} onOpen={vi.fn()} />);
  expect(screen.getByText("只读取项目文件，没有修改操作。")).toBeVisible();
});

it("previews four real agents like the reference, counts every child and retains order as statuses change", async () => {
  const tasks = Array.from({ length: 8 }, (_, i) => child(i));
  const onOpen = vi.fn(),
    onDetails = vi.fn();
  const content = (items: Task[]) => (
    <TooltipProvider>
      <SubagentSummary tasks={items} onOpen={onOpen} onDetails={onDetails} />
    </TooltipProvider>
  );
  const view = render(content(tasks.toReversed()));
  const region = screen.getByRole("region", { name: "子 Agent 摘要" });
  expect(within(region).getByText("8 完成")).toBeVisible();
  expect(
    within(region).getAllByRole("button", { name: /^打开子 Agent/ }),
  ).toHaveLength(4);
  expect(
    within(region).queryByRole("button", { name: "打开子 Agent：分工 4" }),
  ).not.toBeInTheDocument();
  const ids = () =>
    [...region.querySelectorAll("[data-subagent-id]")].map((element) =>
      element.getAttribute("data-subagent-id"),
    );
  expect(ids()).toEqual(["child-0", "child-1", "child-2", "child-3"]);
  fireEvent.click(
    within(region).getByRole("button", { name: "查看全部子 Agent（8）" }),
  );
  expect(onDetails).toHaveBeenCalledOnce();
  const user = userEvent.setup();
  within(region).getByRole("button", { name: "打开子 Agent：分工 1" }).focus();
  await user.keyboard("{Enter}");
  expect(onOpen).toHaveBeenLastCalledWith(tasks[1]);
  const updated = tasks.map((task, i) => ({
    ...task,
    status: i === 0 ? "running" : i === 1 ? "failed" : "completed",
    updatedAt: new Date().toISOString(),
  })) as Task[];
  view.rerender(content(updated.toReversed()));
  expect(ids()).toEqual(["child-0", "child-1", "child-2", "child-3"]);
  expect(within(region).getByText("1 进行中")).toBeVisible();
  expect(within(region).getByText("1 失败")).toBeVisible();
  expect(within(region).getByText("6 完成")).toBeVisible();
});

it("bounds the detail list, searches beyond the first page and filters real states", async () => {
  const tasks = Array.from({ length: 45 }, (_, i) =>
    child(i, i === 44 ? { status: "failed", preview: "检查发现错误" } : {}),
  );
  const onOpen = vi.fn();
  render(<SubagentList tasks={tasks.toReversed()} onOpen={onOpen} />);
  const region = screen.getByRole("region", { name: "子 Agent 列表" });
  expect(within(region).getAllByRole("listitem")).toHaveLength(40);
  const user = userEvent.setup();
  await user.click(
    within(region).getByRole("button", { name: "显示更多（还有 5 个）" }),
  );
  expect(within(region).getAllByRole("listitem")).toHaveLength(45);
  await user.type(
    screen.getByRole("textbox", { name: "搜索子 Agent" }),
    "检查发现错误",
  );
  expect(within(region).getAllByRole("listitem")).toHaveLength(1);
  await user.click(
    screen.getByRole("button", { name: "打开子 Agent：分工 44" }),
  );
  expect(onOpen).toHaveBeenCalledWith(tasks[44]);
  await user.clear(screen.getByRole("textbox", { name: "搜索子 Agent" }));
  expect(within(region).getAllByRole("listitem")).toHaveLength(40);
  await user.click(screen.getByRole("combobox", { name: "子 Agent 状态" }));
  await user.click(screen.getByRole("option", { name: "失败", exact: true }));
  expect(within(region).getAllByRole("listitem")).toHaveLength(1);
  expect(screen.queryByText("0 tokens")).not.toBeInTheDocument();
  await user.type(
    screen.getByRole("textbox", { name: "搜索子 Agent" }),
    "不存在的分工",
  );
  expect(screen.getByText("没有匹配的子 Agent")).toBeVisible();
});

it("does not label offline or historical children as running or completed, and hides an empty sidebar section", () => {
  const tasks = [
    child(0, { status: "running", deviceOnline: false }),
    child(1, { status: "imported" }),
  ];
  const view = render(
    <TooltipProvider>
      <SubagentSummary tasks={tasks} onOpen={vi.fn()} onDetails={vi.fn()} />
    </TooltipProvider>,
  );
  expect(screen.getByText("1 待同步")).toBeVisible();
  expect(screen.getByText("1 历史会话")).toBeVisible();
  expect(screen.queryByText(/进行中|完成/)).not.toBeInTheDocument();
  expect(
    view.container.querySelector(".motion-safe\\:animate-spin"),
  ).toBeNull();
  view.rerender(
    <TooltipProvider>
      <SubagentSummary tasks={[]} onOpen={vi.fn()} onDetails={vi.fn()} />
    </TooltipProvider>,
  );
  expect(
    screen.queryByRole("region", { name: "子 Agent 摘要" }),
  ).not.toBeInTheDocument();
});
