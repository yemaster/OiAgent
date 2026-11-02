import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  WindowControls,
  WindowTitlebar,
} from "@/components/workspace/WindowTitlebar";
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
it("keeps native window actions and resize state when controls are separate from the navigation titlebar", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  let resized!: () => void;
  const unlisten = vi.fn();
  native.onResized.mockImplementation(async (callback) => {
    resized = callback;
    return unlisten;
  });
  const user = userEvent.setup();
  const view = render(
    <>
      <WindowTitlebar />
      <WindowControls />
    </>,
  );
  expect(screen.getByRole("group", { name: "窗口按钮" })).not.toHaveAttribute(
    "data-tauri-drag-region",
  );
  expect(screen.queryByRole("menubar")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "应用菜单" }),
  ).not.toBeInTheDocument();
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
  render(
    <>
      <WindowTitlebar />
      <WindowControls />
    </>,
  );
  expect(screen.getByLabelText("窗口控制栏")).toBeVisible();
  expect(screen.getByLabelText("窗口控制栏")).toHaveClass("h-12");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByRole("menubar")).not.toBeInTheDocument();
  expect(screen.getByText("OiAgent")).toHaveAttribute("data-tauri-drag-region");
});
