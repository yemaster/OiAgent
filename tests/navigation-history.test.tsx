import {
  act,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it } from "vitest";
import App from "@/App";
import {
  useNavigationHistory,
  type NavigationVisit,
} from "@/hooks/useNavigationHistory";
import type { Page } from "@/lib/types";
const visit = (page: Page): NavigationVisit => ({
  location: { kind: "page", page, project: "all" },
  newTaskKey: 0,
  returnToDraft: null,
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("oiagent-onboarded", "true");
});
it("consumes history in order without recording Back as a new visit or duplicating updates", () => {
  const { result, rerender } = renderHook(
    ({ current }) => useNavigationHistory(current, () => true),
    { initialProps: { current: visit("tasks") } },
  );
  rerender({ current: visit("agents") });
  rerender({ current: visit("agents") });
  rerender({ current: visit("settings") });
  let next: NavigationVisit | null = null;
  act(() => {
    next = result.current.back();
  });
  expect(next).toEqual(visit("agents"));
  rerender({ current: next! });
  act(() => {
    next = result.current.back();
  });
  expect(next).toEqual(visit("tasks"));
  rerender({ current: next! });
  expect(result.current.canGoBack).toBe(false);
});
it("skips closed tabs and unavailable tasks without reopening them", () => {
  const available = (v: NavigationVisit) => v.location.kind === "page";
  const { result, rerender } = renderHook(
    ({ current }) => useNavigationHistory(current, available),
    { initialProps: { current: visit("tasks") } },
  );
  rerender({
    current: { ...visit("tasks"), location: { kind: "task", id: "closed" } },
  });
  rerender({
    current: {
      ...visit("tasks"),
      location: { kind: "file", id: "closed-file" },
    },
  });
  rerender({ current: visit("settings") });
  act(() => expect(result.current.back()).toEqual(visit("tasks")));
});
it("shows Back beside the breadcrumb and returns across settings pages to the starting page", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  const rail = within(screen.getByRole("navigation", { name: "工具栏" }));
  expect(
    screen.queryByRole("button", { name: "返回上一页" }),
  ).not.toBeInTheDocument();
  await user.click(rail.getByRole("button", { name: "设置偏好" }));
  await user.click(
    within(screen.getByRole("complementary", { name: "侧边导航" })).getByRole(
      "button",
      { name: "界面设置" },
    ),
  );
  expect(
    rail.queryByRole("button", { name: "返回上一页" }),
  ).not.toBeInTheDocument();
  expect(
    within(screen.getByLabelText("页面导航栏")).getByRole("button", {
      name: "返回上一页",
    }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "返回上一页" }));
  await screen.findByRole("heading", { name: "通用设置" });
  await user.click(screen.getByRole("button", { name: "返回上一页" }));
  await screen.findByRole("heading", { name: "当前任务" });
  expect(
    screen.queryByRole("button", { name: "返回上一页" }),
  ).not.toBeInTheDocument();
});
it("restores a task draft after visiting another section", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  await user.keyboard("{Control>}n{/Control}");
  await user.type(
    screen.getByRole("textbox", { name: "任务内容" }),
    "保留任务内容",
  );
  const rail = within(screen.getByRole("navigation", { name: "工具栏" }));
  await user.click(
    rail.getByRole("button", { name: "Agent 程序", exact: true }),
  );
  await screen.findByRole("heading", { name: "Agent 程序" });
  await user.click(screen.getByRole("button", { name: "返回上一页" }));
  expect(screen.getByRole("textbox", { name: "任务内容" })).toHaveValue(
    "保留任务内容",
  );
  await user.click(screen.getByRole("button", { name: "返回上一页" }));
  await screen.findByRole("heading", { name: "当前任务" });
  expect(
    screen.queryByRole("button", { name: "返回上一页" }),
  ).not.toBeInTheDocument();
});
it("returns from settings to the open task and its original project context", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  await user.click(
    screen.getByRole("button", { name: /检查 API 错误处理与重试逻辑/ }),
  );
  await screen.findByRole("heading", { name: "检查 API 错误处理与重试逻辑" });
  const rail = within(screen.getByRole("navigation", { name: "工具栏" }));
  await user.click(rail.getByRole("button", { name: "设置偏好" }));
  await user.click(screen.getByRole("button", { name: "返回上一页" }));
  await screen.findByRole("heading", { name: "检查 API 错误处理与重试逻辑" });
  expect(
    within(screen.getByRole("navigation", { name: "面包屑" })).getByText(
      "atlas-web",
    ),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "返回上一页" }));
  await screen.findByRole("heading", { name: "当前任务" });
});
