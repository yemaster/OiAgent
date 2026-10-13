import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  matchesSendShortcut,
  setSendShortcut,
  useSendShortcut,
} from "@/lib/shortcuts";
import { ConversationComposer } from "@/components/workspace/ConversationComposer";
import { demoSnapshot } from "@/lib/demo";
beforeEach(() => localStorage.clear());
it("matches configured keys without sending IME confirmation, newlines, or repeats", () => {
  const enter = {
    key: "Enter",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
  };
  expect(matchesSendShortcut(enter, "enter")).toBe(true);
  expect(matchesSendShortcut(enter, "mod-enter")).toBe(false);
  expect(matchesSendShortcut({ ...enter, metaKey: true }, "mod-enter")).toBe(
    true,
  );
  expect(matchesSendShortcut({ ...enter, ctrlKey: true }, "mod-enter")).toBe(
    true,
  );
  expect(matchesSendShortcut({ ...enter, altKey: true }, "alt-enter")).toBe(
    true,
  );
  for (const extra of [
    { shiftKey: true },
    { repeat: true },
    { isComposing: true },
    { keyCode: 229 },
  ]) {
    expect(matchesSendShortcut({ ...enter, ...extra }, "enter")).toBe(false);
    expect(
      matchesSendShortcut({ ...enter, ctrlKey: true, ...extra }, "mod-enter"),
    ).toBe(false);
  }
  expect(
    matchesSendShortcut({ ...enter, ctrlKey: true, altKey: true }, "mod-enter"),
  ).toBe(false);
});
it("persists the preference and updates already open composers", () => {
  const { result, unmount } = renderHook(useSendShortcut);
  expect(result.current).toBe("mod-enter");
  act(() => setSendShortcut("enter"));
  expect(result.current).toBe("enter");
  unmount();
  expect(renderHook(useSendShortcut).result.current).toBe("enter");
});
it("the composer sends on the configured shortcut and blocks while busy", () => {
  const onSend = vi.fn();
  const props = {
    task: { ...demoSnapshot.tasks[0], status: "completed" as const },
    busy: false,
    canContinue: true,
    prompt: "继续",
    permission: "read-only",
    onPrompt: vi.fn(),
    onPermission: vi.fn(),
    onSend,
    onStart: vi.fn(),
    onStop: vi.fn(),
    onRetry: vi.fn(),
    onLog: vi.fn(),
  };
  const { rerender } = render(<ConversationComposer {...props} />);
  const input = screen.getByRole("textbox", { name: "继续对话" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onSend).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  expect(onSend).toHaveBeenCalledTimes(1);
  act(() => setSendShortcut("enter"));
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(onSend).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onSend).toHaveBeenCalledTimes(2);
  rerender(<ConversationComposer {...props} busy />);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onSend).toHaveBeenCalledTimes(2);
});
it("keeps stop available and offers queue or immediate delivery during execution", async () => {
  const user = (await import("@testing-library/user-event")).default.setup();
  const onSend = vi.fn(),
    onStop = vi.fn();
  render(
    <ConversationComposer
      task={{ ...demoSnapshot.tasks[0], status: "running" }}
      busy={false}
      canContinue
      prompt="改用 SQLite"
      permission="default"
      permissionLive
      onPrompt={vi.fn()}
      onPermission={vi.fn()}
      onSend={onSend}
      onStop={onStop}
      onStart={vi.fn()}
      onRetry={vi.fn()}
      onLog={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: "停止任务" }));
  expect(onStop).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "添加到消息队列" }));
  expect(onSend).toHaveBeenLastCalledWith();
  await user.click(screen.getByRole("button", { name: "发送方式" }));
  await user.click(screen.getByRole("menuitem", { name: /立即发送/ }));
  expect(onSend).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole("combobox", { name: "当前执行权限" })).toBeVisible();
});
