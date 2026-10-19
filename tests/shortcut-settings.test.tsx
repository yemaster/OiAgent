import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ShortcutSettings } from "@/components/workspace/ShortcutSettings";
import {
  captureShortcut,
  matchesShortcut,
  nativeShortcuts,
  setShortcut,
  useShortcuts,
} from "@/lib/shortcuts";

beforeEach(() => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux");
  localStorage.clear();
});
it("records shortcuts in identical rows, retains conflicts, cancels and resets", () => {
  render(<ShortcutSettings />);
  const binding = screen.getByRole("button", {
    name: "发送消息 / 启动任务快捷键",
  });
  fireEvent.click(binding);
  expect(binding).toHaveTextContent("请按快捷键");
  fireEvent.keyDown(binding, { key: "Shift", shiftKey: true });
  expect(binding).toHaveAttribute("aria-pressed", "true");
  fireEvent.keyDown(binding, { key: "n", ctrlKey: true });
  expect(binding).toHaveTextContent("Ctrl + N");
  expect(screen.getAllByText("冲突")).toHaveLength(2);
  const { result } = renderHook(useShortcuts);
  expect(result.current.send).toBe("Ctrl+N");
  expect(result.current["new-task"]).toBe("Mod+N");
  const newline = screen.getByRole("button", { name: "对话框中换行快捷键" });
  fireEvent.click(newline);
  fireEvent.keyDown(newline, { key: "Escape" });
  expect(newline).toHaveTextContent("Shift + Enter");
  fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
  expect(screen.queryByText("冲突")).not.toBeInTheDocument();
  expect(result.current.send).toBe("Mod+Enter");
});
it("migrates saved send preferences and resolves native conflicts without altering preferences", () => {
  localStorage.setItem("oiagent-send-shortcut", "alt-enter");
  const { result } = renderHook(useShortcuts);
  expect(result.current.send).toBe("Alt+Enter");
  act(() => {
    setShortcut("search", "Mod+N");
    setShortcut("send", "Mod+N");
  });
  expect(nativeShortcuts(result.current, false)).toMatchObject({
    "new-task": "CmdOrCtrl+N",
    search: "",
  });
  expect(nativeShortcuts(result.current, true)).toMatchObject({
    "new-task": "",
    search: "",
  });
  expect(result.current.search).toBe("Mod+N");
});
it("records physical keys for Option and shifted punctuation, ignoring IME", () => {
  const event = {
    key: "å",
    code: "KeyA",
    altKey: true,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    repeat: false,
  };
  expect(captureShortcut(event)).toBe("Alt+A");
  expect(matchesShortcut(event, "Alt+A")).toBe(true);
  expect(captureShortcut({ ...event, isComposing: true })).toBeNull();
  expect(
    captureShortcut({
      ...event,
      key: "+",
      code: "Equal",
      altKey: false,
      shiftKey: true,
    }),
  ).toBe("Shift+=");
});

it("keeps platform bindings, migrations and resets independent", async () => {
  const { resetShortcuts, shortcutLabel } = await import("@/lib/shortcuts");
  localStorage.setItem(
    "oiagent-shortcuts",
    JSON.stringify({ send: "Alt+Enter" }),
  );
  const current = renderHook(() => useShortcuts("linux"));
  const mac = renderHook(() => useShortcuts("macos"));
  const win = renderHook(() => useShortcuts("windows"));
  expect(current.result.current.send).toBe("Alt+Enter");
  expect(mac.result.current.send).toBe("Mod+Enter");
  expect(mac.result.current.back).toBe("Mod+[");
  act(() => setShortcut("send", "Meta+Y", "macos"));
  expect(current.result.current.send).toBe("Alt+Enter");
  expect(mac.result.current.send).toBe("Meta+Y");
  expect(win.result.current.send).toBe("Mod+Enter");
  expect(localStorage.getItem("oiagent-shortcuts")).toBeNull();
  act(() => setShortcut("send", "Ctrl+Y", "windows"));
  act(() => resetShortcuts("macos"));
  expect(mac.result.current.send).toBe("Mod+Enter");
  expect(win.result.current.send).toBe("Ctrl+Y");
  expect(current.result.current.send).toBe("Alt+Enter");
  expect(shortcutLabel("Mod+F", "windows")).toBe("Ctrl + F");
  expect(shortcutLabel("Mod+F", "linux")).toBe("Ctrl + F");
  expect(shortcutLabel("Mod+F", "macos")).toBe("⌘ + F");
});
it.each(["windows", "linux", "macos"] as const)(
  "matches only the native modifier on %s",
  (platform) => {
    const key = {
      key: "f",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      repeat: false,
    };
    expect(matchesShortcut({ ...key, ctrlKey: true }, "Mod+F", platform)).toBe(
      platform !== "macos",
    );
    expect(matchesShortcut({ ...key, metaKey: true }, "Mod+F", platform)).toBe(
      platform === "macos",
    );
    expect(
      matchesShortcut(
        { ...key, ctrlKey: true, metaKey: true },
        "Mod+F",
        platform,
      ),
    ).toBe(false);
  },
);
it("switches the settings list without changing the active platform shortcuts", async () => {
  const user = (await import("@testing-library/user-event")).default.setup();
  render(<ShortcutSettings />);
  await user.click(screen.getByRole("tab", { name: "macOS" }));
  const binding = screen.getByRole("button", { name: "搜索当前对话快捷键" });
  expect(binding).toHaveTextContent("⌘ + F");
  await user.click(binding);
  fireEvent.keyDown(binding, { key: "k", metaKey: true });
  expect(screen.getAllByText("冲突")).toHaveLength(2);
  await user.click(screen.getByRole("tab", { name: "Windows" }));
  expect(binding).toHaveTextContent("Ctrl + F");
  expect(screen.queryByText("冲突")).not.toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "macOS" }));
  expect(binding).toHaveTextContent("⌘ + K");
});
