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
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux");
  localStorage.clear();
  vi.mocked(call).mockReset().mockResolvedValue(demoSnapshot.tasks[0]);
});
it.each([
  ["mod-enter", { ctrlKey: true }, "Win32"],
  ["mod-enter", { ctrlKey: true }, "Linux"],
  ["mod-enter", { metaKey: true }, "MacIntel"],
  ["enter", {}, "Linux"],
  ["alt-enter", { altKey: true }, "Linux"],
] as [
  SendShortcut,
  { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
  string,
][])(
  "uses %s consistently in both open composers and protects IME/newlines",
  async (shortcut, modifiers, platform) => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
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
        ).toBe(!(shortcut === "enter" && "shiftKey" in extra));
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

it("uses custom send and newline bindings in both composers, replacing selected text", async () => {
  const { setShortcut } = await import("@/lib/shortcuts");
  const created = vi.fn(),
    sent = vi.fn(),
    changed = vi.fn();
  const task = demoSnapshot.tasks[0];
  render(
    <>
      <NewTaskPage
        snapshot={demoSnapshot}
        project={task.project}
        seed={{ ...task, prompt: "abc" }}
        onCreated={created}
        onSettings={vi.fn()}
        onAgents={vi.fn()}
      />
      <ConversationComposer
        task={task}
        busy={false}
        canContinue
        prompt="abc"
        permission="default"
        onPrompt={changed}
        onPermission={vi.fn()}
        onSend={sent}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onRetry={vi.fn()}
        onLog={vi.fn()}
      />
    </>,
  );
  act(() => {
    setShortcut("send", "Ctrl+Shift+Y");
    setShortcut("newline", "Alt+L");
  });
  const inputs = [
    screen.getByRole("textbox", { name: "任务内容" }),
    screen.getByRole("textbox", { name: "继续对话" }),
  ] as HTMLTextAreaElement[];
  for (const input of inputs) {
    input.setSelectionRange(1, 2);
    fireEvent.keyDown(input, { key: "l", altKey: true });
  }
  expect(inputs[0]).toHaveValue("a\nc");
  expect(changed).toHaveBeenLastCalledWith("a\nc");
  expect(sent).not.toHaveBeenCalled();
  for (const input of inputs)
    fireEvent.keyDown(input, { key: "y", ctrlKey: true, shiftKey: true });
  await waitFor(() => expect(created).toHaveBeenCalledOnce());
  expect(sent).toHaveBeenCalledOnce();
});

it("submits the visible supervision setting and preserves it in the task draft", async () => {
  const user = (await import("@testing-library/user-event")).default.setup();
  const onDraftChange = vi.fn();
  const task = demoSnapshot.tasks[0];
  render(<NewTaskPage snapshot={demoSnapshot} project={task.project} seed={{ ...task, prompt: "检查项目" }} onCreated={vi.fn()} onSettings={vi.fn()} onAgents={vi.fn()} onDraftChange={onDraftChange} />);
  await user.click(screen.getByRole("button", { name: "监管：关闭" }));
  await user.click(screen.getByRole("radio", { name: /谨慎接管/ }));
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "监管：谨慎接管" })).toBeVisible();
  fireEvent.keyDown(screen.getByRole("textbox", { name: "任务内容" }), { key: "Enter", ctrlKey: true });
  await waitFor(() => expect(call).toHaveBeenCalledWith("create_task", expect.objectContaining({ supervision: { mode: "cautious", maxRetries: 2 } })));
  expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({ supervision: { mode: "cautious", maxRetries: 2 } }));
});
