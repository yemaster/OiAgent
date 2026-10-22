import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { TitlebarMenu } from "@/components/workspace/TitlebarMenu";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({ call: vi.fn().mockResolvedValue(undefined) }));
beforeEach(() => vi.mocked(call).mockClear());
it("opens each existing native submenu without stealing the editor selection", async () => {
  const user = userEvent.setup();
  render(
    <>
      <input aria-label="编辑内容" defaultValue="copy this" />
      <TitlebarMenu />
    </>,
  );
  const input = screen.getByRole("textbox") as HTMLInputElement;
  input.focus();
  input.setSelectionRange(0, 4);
  const edit = screen.getByRole("menuitem", { name: "编辑" });
  vi.spyOn(edit, "getBoundingClientRect").mockReturnValue({
    left: 88,
  } as DOMRect);
  await user.click(edit);
  expect(call).toHaveBeenCalledWith("show_application_menu", {
    menuId: "edit",
    x: 88,
    y: 0,
  });
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(4);
  await user.keyboard("{F10}{ArrowRight}{ArrowRight}{ArrowDown}");
  expect(call).toHaveBeenLastCalledWith("show_application_menu", {
    menuId: "view",
    x: 0,
    y: 0,
  });
  expect(input).toHaveFocus();
  await user.keyboard("{Alt>}h{/Alt}");
  expect(call).toHaveBeenLastCalledWith("show_application_menu", {
    menuId: "help",
    x: 0,
    y: 0,
  });
});
it("leaves terminal shortcuts to the TUI and releases its keyboard listener", () => {
  const view = render(
    <>
      <div data-terminal-surface>
        <textarea aria-label="终端" />
      </div>
      <TitlebarMenu />
    </>,
  );
  const terminal = screen.getByRole("textbox");
  fireEvent.keyDown(terminal, { key: "f", altKey: true });
  expect(call).not.toHaveBeenCalled();
  view.unmount();
  fireEvent.keyDown(window, { key: "f", altKey: true });
  expect(call).not.toHaveBeenCalled();
});

it("supports Alt focus and exposes task, agent and terminal menus", async () => {
  const user = userEvent.setup();
  render(
    <>
      <input aria-label="草稿" />
      <TitlebarMenu />
    </>,
  );
  const input = screen.getByRole("textbox");
  input.focus();
  await user.keyboard("{Alt}");
  expect(screen.getByRole("menuitem", { name: "文件" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(input).toHaveFocus();
  for (const [name, menuId] of [
    ["任务", "task"],
    ["Agent", "agent"],
    ["终端", "terminal"],
  ]) {
    await user.click(screen.getByRole("menuitem", { name }));
    expect(call).toHaveBeenLastCalledWith("show_application_menu", {
      menuId,
      x: 0,
      y: 0,
    });
  }
});
