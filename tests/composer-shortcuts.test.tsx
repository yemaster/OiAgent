import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { NewTaskPage } from "@/pages/NewTask";
import { ConversationComposer } from "@/components/workspace/ConversationComposer";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
import { setSendShortcut, type SendShortcut } from "@/lib/shortcuts";
vi.mock("@/lib/api", () => ({
  desktop: true,
  call: vi.fn(),
  pickDirectory: vi.fn(),
}));
beforeEach(() => {
  localStorage.clear();
  vi.mocked(call).mockReset().mockResolvedValue(demoSnapshot.tasks[0]);
});
it.each([
  ["mod-enter", { ctrlKey: true }],
  ["mod-enter", { metaKey: true }],
  ["enter", {}],
  ["alt-enter", { altKey: true }],
] as [
  SendShortcut,
  { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
][])(
  "uses %s consistently in both open composers and protects IME/newlines",
  async (shortcut, modifiers) => {
    const created = vi.fn(),
      sent = vi.fn();
    const task = { ...demoSnapshot.tasks[0], status: "running" as const };
    render(
      <>
        <NewTaskPage
          snapshot={demoSnapshot}
          project={task.project}
          seed={{ ...task, prompt: "检查项目" }}
          onCreated={created}
          onSettings={vi.fn()}
          onAgents={vi.fn()}
        />
        <ConversationComposer
          task={task}
          busy={false}
          canContinue
          prompt="继续检查"
          permission="default"
          onPrompt={vi.fn()}
          onPermission={vi.fn()}
          onSend={sent}
          onStart={vi.fn()}
          onStop={vi.fn()}
          onRetry={vi.fn()}
          onLog={vi.fn()}
        />
      </>,
    );
    const inputs = [
      screen.getByRole("textbox", { name: "任务内容" }),
      screen.getByRole("textbox", { name: "继续对话" }),
    ];
    // Update the preference after mount: both inputs must adopt it immediately.
    act(() => setSendShortcut(shortcut));
    for (const input of inputs) {
      const wrongModifiers = shortcut === "enter" ? { ctrlKey: true } : {};
      expect(
        fireEvent.keyDown(input, { key: "Enter", ...wrongModifiers }),
      ).toBe(true);
      for (const extra of [
        { shiftKey: true },
        { isComposing: true },
        { keyCode: 229 },
        { repeat: true },
      ]) {
        expect(
          fireEvent.keyDown(input, { key: "Enter", ...modifiers, ...extra }),
        ).toBe(true);
      }
    }
    expect(created).not.toHaveBeenCalled();
    expect(sent).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalledWith("create_task", expect.anything());
    for (const input of inputs)
      fireEvent.keyDown(input, { key: "Enter", ...modifiers });
    await waitFor(() => expect(created).toHaveBeenCalledOnce());
    expect(sent).toHaveBeenCalledExactlyOnceWith();
    expect(
      screen.getByRole("button", { name: "添加到消息队列" }).title,
    ).toContain("Shift + Enter 换行");
    expect(screen.getByRole("button", { name: "启动任务" }).title).toContain(
      "Shift + Enter 换行",
    );
  },
);
