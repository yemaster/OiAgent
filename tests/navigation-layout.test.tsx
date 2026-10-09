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
  await screen.findByRole("heading", { name: "当前任务" });
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
  expect(screen.getByRole("textbox", { name: "项目目录" })).toHaveValue(
    "/Users/demo/Projects/atlas-web",
  );
  expect(
    screen.getByRole("tab", { name: /检查 API 错误处理与重试逻辑/ }),
  ).toBeInTheDocument();
});
