import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { WindowTitlebar } from "@/components/workspace/WindowTitlebar";
import { call } from "@/lib/api";
const native = vi.hoisted(() => ({
  minimize: vi.fn().mockResolvedValue(undefined),
  toggleMaximize: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  isMaximized: vi.fn().mockResolvedValue(false),
  onResized: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
vi.mock("@/lib/api", () => ({
  desktop: true,
  call: vi.fn().mockResolvedValue(undefined),
}));
afterEach(() => vi.restoreAllMocks());
it("keeps native window actions, resize state and the application menu accessible", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  let resized!: () => void;
  const unlisten = vi.fn();
  native.onResized.mockImplementation(async (callback) => {
    resized = callback;
    return unlisten;
  });
  const user = userEvent.setup();
  const view = render(<WindowTitlebar />);
  expect(screen.getByRole("menubar", { name: "应用菜单" })).toBeVisible();
  expect(
    screen.getAllByRole("menuitem").map((item) => item.textContent),
  ).toEqual(["文件", "编辑", "视图", "任务", "Agent", "终端", "窗口", "帮助"]);
  await user.click(screen.getByRole("menuitem", { name: "文件" }));
  expect(call).toHaveBeenCalledWith("show_application_menu", {
    menuId: "file",
    x: 0,
    y: 0,
  });
  await user.click(screen.getByRole("button", { name: "最小化窗口" }));
  expect(native.minimize).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "最大化窗口" }));
  expect(native.toggleMaximize).toHaveBeenCalledOnce();
  native.isMaximized.mockResolvedValue(true);
  await act(async () => resized());
  expect(await screen.findByRole("button", { name: "还原窗口" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "关闭窗口" }));
  expect(native.close).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("窗口控制栏")).toHaveAttribute(
    "data-tauri-drag-region",
  );
  view.unmount();
  await waitFor(() => expect(unlisten).toHaveBeenCalledOnce());
});
it("leaves macOS window buttons to the native overlay", () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  render(<WindowTitlebar />);
  expect(screen.getByLabelText("窗口控制栏")).toBeVisible();
  expect(screen.getByLabelText("窗口控制栏")).toHaveClass("h-16");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByRole("menubar")).not.toBeInTheDocument();
  expect(screen.getByText("OiAgent")).toHaveAttribute("data-tauri-drag-region");
});
