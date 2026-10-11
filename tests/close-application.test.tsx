import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { CloseInfo } from "@/lib/lifecycle";
const mock = vi.hoisted(() => ({
  call: vi.fn(),
  callback: undefined as (() => void) | undefined,
}));
vi.mock("@/lib/api", () => ({ desktop: true, call: mock.call }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name, fn) => {
    mock.callback = fn;
    return () => {
      mock.callback = undefined;
    };
  }),
}));
import { CloseApplication } from "@/components/workspace/CloseApplication";
let info: CloseInfo;
beforeEach(() => {
  info = { behavior: "ask", trayAvailable: true, running: 2, pending: "close" };
  mock.call
    .mockReset()
    .mockImplementation(async (command: string) =>
      command === "close_info" ? info : undefined,
    );
});
it("offers tray, stop-and-exit and cancel, and persists only a confirmed choice", async () => {
  render(<CloseApplication dirtyFiles={0} />);
  await screen.findByRole("dialog");
  expect(screen.getByText(/2 个任务运行中/)).toBeVisible();
  expect(screen.getByRole("button", { name: "退出并停止任务" })).toBeVisible();
  expect(mock.call).not.toHaveBeenCalledWith("apply_close", expect.anything());
  await userEvent.click(screen.getByRole("checkbox", { name: "记住此选择" }));
  await userEvent.click(screen.getByRole("button", { name: "最小化到托盘" }));
  expect(mock.call).toHaveBeenCalledWith("apply_close", {
    action: "tray",
    remember: true,
    confirmed: false,
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("rechecks dirty files when the close request arrives", async () => {
  info = { ...info, behavior: "quit", running: 0, pending: null };
  const view = render(<CloseApplication dirtyFiles={0} />);
  await waitFor(() => expect(mock.call).toHaveBeenCalledWith("close_info"));
  view.rerender(<CloseApplication dirtyFiles={1} />);
  info = { ...info, pending: "quit" };
  act(() => mock.callback?.());
  await screen.findByRole("dialog");
  expect(screen.getByRole("alert")).toHaveTextContent("1 个文件未保存");
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(mock.call).toHaveBeenCalledWith("apply_close", {
    action: "cancel",
    remember: false,
    confirmed: false,
  });
});
it("never offers tray when registration failed", async () => {
  info.trayAvailable = false;
  render(<CloseApplication dirtyFiles={0} />);
  await screen.findByRole("dialog");
  expect(
    screen.queryByRole("button", { name: "最小化到托盘" }),
  ).not.toBeInTheDocument();
});
