import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "@/App";
vi.mock("@/lib/api", async (original) => {
  const api = await original<typeof import("@/lib/api")>();
  return { ...api, desktop: true, call: vi.fn(api.call) };
});
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async () => () => {},
    isMaximized: async () => false,
    onResized: async () => () => {},
  }),
}));
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("oiagent-onboarded", "true");
});
afterEach(() => vi.restoreAllMocks());

it("keeps macOS window controls in the navigation column without adding a row above the main content", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  const main = screen.getByRole("main");
  const titlebar = screen.getByLabelText("窗口控制栏");
  const navigation = titlebar.closest("[data-workspace-navigation]");
  expect(navigation).not.toBeNull();
  expect(navigation?.parentElement).toBe(main.parentElement);
  // The header cannot contribute its traffic-light/brand width to the column.
  expect(titlebar.parentElement).toHaveClass(
    "absolute",
    "inset-0",
    "overflow-hidden",
  );
  const header = within(main).getByLabelText("页面导航栏");
  expect(header).not.toHaveClass("pl-12");
  expect(
    within(titlebar).getByRole("button", { name: "前进到下一页" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /收起侧边栏|展开侧边栏/ }),
  ).not.toBeInTheDocument();
  const sidebar = screen.getByRole("complementary", { name: "侧边导航" });
  fireEvent.keyDown(window, { key: "b", metaKey: true });
  expect(sidebar).toBeVisible();
  expect(sidebar.parentElement).not.toHaveAttribute("inert");
  expect(screen.getAllByRole("group", { name: "工作区导航" })).toHaveLength(1);
});

it("keeps Windows content at the top with window controls in the page header and the menu in the rail", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  const main = screen.getByRole("main");
  const titlebar = screen.getByLabelText("窗口控制栏");
  const navigation = titlebar.closest("[data-workspace-navigation]");
  expect(navigation).not.toBeNull();
  expect(navigation?.parentElement).toBe(main.parentElement);
  const header = within(main).getByLabelText("页面导航栏");
  const controls = within(header).getByRole("group", { name: "窗口按钮" });
  expect(controls).toBe(header.lastElementChild);
  expect(within(controls).getAllByRole("button")).toHaveLength(3);
  expect(
    within(titlebar).queryByRole("group", { name: "窗口按钮" }),
  ).not.toBeInTheDocument();
  expect(header).not.toHaveClass("pl-12");
  expect(header).toHaveAttribute("data-tauri-drag-region");
  expect(
    within(titlebar).getByRole("button", { name: "前进到下一页" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /收起侧边栏|展开侧边栏/ }),
  ).not.toBeInTheDocument();
  const sidebar = screen.getByRole("complementary", { name: "侧边导航" });
  fireEvent.keyDown(window, { key: "b", ctrlKey: true });
  expect(sidebar).toBeVisible();
  expect(sidebar.parentElement).not.toHaveAttribute("inert");
  expect(within(header).getByRole("group", { name: "窗口按钮" })).toBe(
    controls,
  );
  expect(
    within(screen.getByRole("navigation", { name: "工具栏" })).getByRole(
      "button",
      { name: "应用菜单" },
    ),
  ).toBeVisible();
});
