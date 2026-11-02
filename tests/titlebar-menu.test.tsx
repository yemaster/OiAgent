import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { TitlebarMenu } from "@/components/workspace/TitlebarMenu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({ call: vi.fn().mockResolvedValue(undefined) }));
beforeEach(() => vi.mocked(call).mockClear());
it("opens the complete compact menu without taking the editor selection", async () => {
  render(
    <TooltipProvider>
      <input aria-label="编辑内容" defaultValue="copy this" />
      <TitlebarMenu />
    </TooltipProvider>,
  );
  const user = userEvent.setup();
  const input = screen.getByRole("textbox") as HTMLInputElement;
  input.focus();
  input.setSelectionRange(0, 4);
  const trigger = screen.getByRole("button", { name: "应用菜单" });
  vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
    right: 48,
    top: 64,
  } as DOMRect);
  await user.click(trigger);
  expect(call).toHaveBeenLastCalledWith("show_application_menu", {
    menuId: "application",
    x: 48,
    y: 64,
  });
  expect(input).toHaveFocus();
  expect(input.selectionEnd).toBe(4);
  await user.keyboard("{F10}{ArrowRight}");
  expect(input).toHaveFocus();
  await user.keyboard("{Alt>}e{/Alt}");
  expect(call).toHaveBeenLastCalledWith("show_application_menu", {
    menuId: "edit",
    x: 48,
    y: 64,
  });
  await user.keyboard("{Alt}");
  expect(trigger).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(input).toHaveFocus();
});
it("leaves TUI shortcuts alone and removes listeners on unmount", () => {
  const view = render(
    <TooltipProvider>
      <div data-terminal-surface>
        <textarea aria-label="终端" />
      </div>
      <TitlebarMenu />
    </TooltipProvider>,
  );
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "f", altKey: true });
  expect(call).not.toHaveBeenCalled();
  view.unmount();
  fireEvent.keyDown(window, { key: "f", altKey: true });
  expect(call).not.toHaveBeenCalled();
});
