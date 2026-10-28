import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import App from "@/App";

it("keeps the saved sidebar width across sections and restores the last workspace", async () => {
  localStorage.setItem("oiagent-onboarded", "true");
  localStorage.setItem("oiagent-sidebar-width", "280");
  const user = userEvent.setup();
  const view = render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  const sidebar = screen.getByRole("complementary", { name: "侧边导航" });
  expect(sidebar.style.width).toBe("280px");
  const handle = screen.getByRole("separator", { name: "调整侧边栏宽度" });
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(sidebar.style.width).toBe("296px");
  // Pointer dragging follows the same separator and persists its result.
  const capture = vi.fn();
  handle.setPointerCapture = capture;
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 352 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 392 });
  fireEvent.pointerUp(handle, { pointerId: 1 });
  expect(sidebar.style.width).toBe("336px");
  await user.click(
    within(sidebar).getByRole("button", { name: "历史记录", exact: true }),
  );
  await screen.findByRole("heading", { name: "历史记录" });
  const rail = within(screen.getByRole("navigation", { name: "工具栏" }));
  await user.click(
    rail.getByRole("button", { name: "Agent 程序", exact: true }),
  );
  await screen.findByRole("heading", { name: "Agent 程序" });
  expect(sidebar.style.width).toBe("336px");
  await user.click(rail.getByRole("button", { name: "工作台", exact: true }));
  await screen.findByRole("heading", { name: "历史记录" });
  expect(sidebar.style.width).toBe("336px");
  expect(screen.queryByText("所有记录保存在本机")).not.toBeInTheDocument();
  view.unmount();
  render(<App />);
  await screen.findByRole("heading", { name: "历史记录" });
  expect(
    screen.getByRole("complementary", { name: "侧边导航" }).style.width,
  ).toBe("336px");
  localStorage.removeItem("oiagent-sidebar-width");
});

it("creates a blank task in the open task project and leaves its tab available", async () => {
  localStorage.setItem("oiagent-onboarded", "true");
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  await user.click(
    screen.getByRole("button", {
      name: /^打开会话：检查 API 错误处理与重试逻辑/,
    }),
  );
  await screen.findByRole("heading", { name: "检查 API 错误处理与重试逻辑" });
  await user.keyboard("{Control>}n{/Control}");
  await screen.findByRole("textbox", { name: "任务内容" });
  expect(screen.getByRole("textbox", { name: "任务内容" })).toHaveValue("");
  await user.click(screen.getByRole("button", { name: "选择项目" }));
  expect(screen.getByRole("option", { name: /atlas-web/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    screen.getByRole("tab", { name: /检查 API 错误处理与重试逻辑/ }),
  ).toBeInTheDocument();
});

it("keeps project navigation available and returns from project settings to that project", async () => {
  localStorage.clear();
  localStorage.setItem("oiagent-onboarded", "true");
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  const sidebar = within(
    screen.getByRole("complementary", { name: "侧边导航" }),
  );
  await user.click(
    sidebar.getByRole("button", { name: "atlas-web", exact: true }),
  );
  await screen.findByRole("heading", { name: "atlas-web" });
  expect(
    sidebar.getByRole("button", { name: "atlas-web", exact: true }),
  ).toHaveAttribute("aria-current", "location");
  expect(
    sidebar.getByRole("button", { name: /^当前任务/ }),
  ).not.toHaveAttribute("aria-current");
  expect(sidebar.queryByRole("tab")).not.toBeInTheDocument();
  const fileSection = sidebar.getByRole("region", { name: "项目文件" });
  expect(
    fileSection.compareDocumentPosition(
      sidebar.getByRole("region", { name: "项目列表" }),
    ) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  const files = within(fileSection);
  expect(
    files.getByRole("button", { name: "文件", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  expect(
    sidebar.getByRole("button", { name: "atlas-web", exact: true }),
  ).toBeVisible();
  await user.click(files.getByRole("button", { name: "文件", exact: true }));
  expect(
    files.getByRole("button", { name: "文件", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  expect(
    sidebar.getByRole("button", { name: "atlas-web", exact: true }),
  ).toBeVisible();
  await user.click(sidebar.getByRole("button", { name: "任务", exact: true }));
  expect(
    sidebar.getByRole("button", { name: "任务", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await user.click(files.getByRole("button", { name: "文件", exact: true }));
  expect(
    files.getByRole("button", { name: "文件", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await user.click(sidebar.getByRole("button", { name: "任务", exact: true }));
  await user.click(screen.getByRole("button", { name: "项目设置" }));
  await user.click(screen.getByRole("menuitem", { name: "项目指令" }));
  await screen.findByRole("heading", { name: "指令文件" });
  expect(screen.getByRole("combobox", { name: "作用范围" })).toHaveTextContent(
    "atlas-web",
  );
  await user.click(screen.getByRole("button", { name: "返回上一页" }));
  await screen.findByRole("heading", { name: "atlas-web" });
  await user.click(screen.getByRole("button", { name: "项目设置" }));
  await user.click(screen.getByRole("menuitem", { name: "MCP 与 Skills" }));
  await screen.findByRole("heading", { name: "MCP 与 Skills" });
  expect(
    screen.getByRole("button", { name: "切换 Agent 和作用范围" }),
  ).toHaveTextContent("atlas-web");
  await user.click(screen.getByRole("button", { name: "返回上一页" }));
  await screen.findByRole("heading", { name: "atlas-web" });
});

it("names the page tab after its project and exits without closing task tabs", async () => {
  localStorage.setItem("oiagent-onboarded", "true");
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  const sidebar = within(
    screen.getByRole("complementary", { name: "侧边导航" }),
  );
  await user.click(
    sidebar.getByRole("button", { name: "atlas-web", exact: true }),
  );
  const projectTab = await screen.findByRole("tab", {
    name: "当前页面：atlas-web",
  });
  expect(projectTab).toHaveAttribute("aria-selected", "true");
  await user.click(
    screen.getByRole("button", {
      name: /^打开会话：检查 API 错误处理与重试逻辑/,
    }),
  );
  await screen.findByRole("heading", { name: "检查 API 错误处理与重试逻辑" });
  expect(
    screen.getByRole("tab", { name: "当前页面：atlas-web" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "退出项目：atlas-web" }));
  await screen.findByRole("heading", { name: "当前任务" });
  expect(
    screen.getByRole("tab", { name: "当前页面：当前任务" }),
  ).toHaveAttribute("aria-selected", "true");
  expect(
    screen.getByRole("tab", { name: /检查 API 错误处理与重试逻辑/ }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "退出项目：atlas-web" }),
  ).not.toBeInTheDocument();
  expect(
    sidebar.getByRole("button", { name: "atlas-web", exact: true }),
  ).not.toHaveAttribute("aria-current");
  await user.click(
    sidebar.getByRole("button", { name: "atlas-web", exact: true }),
  );
  await user.keyboard("{Control>}w{/Control}");
  expect(
    screen.getByRole("tab", { name: "当前页面：当前任务" }),
  ).toHaveAttribute("aria-selected", "true");
});

it("opens and collapses recent tasks in their project group", async () => {
  localStorage.clear();
  localStorage.setItem("oiagent-onboarded", "true");
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  const sidebar = within(
    screen.getByRole("complementary", { name: "侧边导航" }),
  );
  const row = sidebar.getByRole("button", {
    name: "打开任务：检查 API 错误处理与重试逻辑",
  });
  await user.click(row);
  await screen.findByRole("heading", { name: "检查 API 错误处理与重试逻辑" });
  expect(row).toHaveAttribute("aria-current", "page");
  await user.click(
    sidebar.getByRole("button", { name: "收起项目任务：atlas-web" }),
  );
  expect(
    sidebar.queryByRole("button", {
      name: "打开任务：检查 API 错误处理与重试逻辑",
    }),
  ).not.toBeInTheDocument();
  await user.click(
    sidebar.getByRole("button", { name: "展开项目任务：atlas-web" }),
  );
  expect(
    sidebar.getByRole("button", {
      name: "打开任务：检查 API 错误处理与重试逻辑",
    }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "项目操作：atlas-web" }));
  expect(
    screen.getByRole("menuitem", { name: "在文件夹中显示" }),
  ).toBeVisible();
});

it("keeps the page header and tabs inside the same content frame", async () => {
  localStorage.clear();
  localStorage.setItem("oiagent-onboarded", "true");
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  const main = screen.getByRole("main");
  expect(within(main).getByLabelText("页面导航栏")).toBeVisible();
  expect(within(main).getByRole("tablist")).toBeVisible();
  expect(screen.queryByLabelText("窗口控制栏")).not.toBeInTheDocument();
  expect(
    within(screen.getByRole("complementary", { name: "侧边导航" })).queryByRole(
      "textbox",
      { name: "筛选项目" },
    ),
  ).not.toBeInTheDocument();
});
