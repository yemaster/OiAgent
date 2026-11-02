import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TasksPage } from "@/pages/Tasks";
import { WorkspaceNavigation } from "@/components/workspace/Navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { demoSnapshot } from "@/lib/demo";
import type { Task } from "@/lib/types";

it("keeps concurrent task rows in place in the main list and project sidebar as output alternates", () => {
  const tasks = ["first", "second"].map((id, index): Task => ({
    ...demoSnapshot.tasks[0],
    id,
    title: id,
    status: "running",
    archived: false,
    parentId: undefined,
    project: "/stable-project",
    createdAt: `2026-11-02T10:00:0${index}Z`,
    updatedAt: `2026-11-02T10:01:0${index}Z`,
  }));
  function page(current: Task[]) {
    const snapshot = {
      ...demoSnapshot,
      tasks: current,
      projects: ["/stable-project"],
    };
    return (
      <TooltipProvider>
        <WorkspaceNavigation
          page="tasks"
          project="all"
          snapshot={snapshot}
          onNavigate={vi.fn()}
          onProject={vi.fn()}
          onAddProject={vi.fn()}
          onSearch={vi.fn()}
        />
        <TasksPage
          snapshot={snapshot}
          project="all"
          onOpen={vi.fn()}
          onNew={vi.fn()}
          onProject={vi.fn()}
          onHistory={vi.fn()}
          onStats={vi.fn()}
        />
      </TooltipProvider>
    );
  }
  const view = render(page(tasks));
  const rows = () =>
    within(screen.getByRole("region", { name: "进行中" })).getAllByRole(
      "button",
      { name: /^打开会话/ },
    );
  const sidebarRows = () =>
    within(
      screen.getByRole("complementary", { name: "侧边导航" }),
    ).getAllByRole("button", { name: /^打开任务/ });
  const firstRows = rows();
  const firstSidebar = sidebarRows();
  expect(firstRows.map((row) => row.getAttribute("aria-label"))).toEqual([
    "打开会话：second",
    "打开会话：first",
  ]);
  for (let round = 0; round < 4; round++) {
    tasks[round % 2] = {
      ...tasks[round % 2],
      updatedAt: `2026-11-02T10:02:0${round}Z`,
      preview: `output ${round}`,
    };
    view.rerender(page([...tasks].reverse()));
    expect(rows()).toEqual(firstRows);
    expect(sidebarRows()).toEqual(firstSidebar);
    expect(
      within(firstRows[round % 2 === 0 ? 1 : 0]).getByText(`output ${round}`, {
        exact: false,
      }),
    ).toBeVisible();
  }
});
