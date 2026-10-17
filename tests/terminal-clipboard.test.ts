import { beforeEach, expect, it, vi } from "vitest";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  terminalClipboardAction,
  terminalKeyHandler,
} from "@/lib/terminalClipboard";

vi.mock("@/lib/api", () => ({ desktop: true }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(),
  writeText: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());
const key = (value: string, options: KeyboardEventInit = {}) =>
  new KeyboardEvent("keydown", { key: value, cancelable: true, ...options });

it("copies selected output, but preserves Ctrl+C interruption without a selection on Windows/Linux", () => {
  expect(
    terminalClipboardAction(key("c", { ctrlKey: true }), true, false),
  ).toBe("copy");
  expect(
    terminalClipboardAction(key("c", { ctrlKey: true }), false, false),
  ).toBeUndefined();
  expect(
    terminalClipboardAction(
      key("c", { ctrlKey: true, shiftKey: true }),
      false,
      false,
    ),
  ).toBe("copy");
  expect(
    terminalClipboardAction(key("v", { ctrlKey: true }), false, false),
  ).toBe("paste");
  expect(
    terminalClipboardAction(
      key("V", { ctrlKey: true, shiftKey: true }),
      false,
      false,
    ),
  ).toBe("paste");
  expect(
    terminalClipboardAction(key("Insert", { shiftKey: true }), false, false),
  ).toBe("paste");
  expect(
    terminalClipboardAction(key("Insert", { ctrlKey: true }), true, false),
  ).toBe("copy");
});

it("keeps macOS Cmd clipboard keys separate from TUI Ctrl+C/V and AltGr", () => {
  expect(terminalClipboardAction(key("c", { metaKey: true }), true, true)).toBe(
    "copy",
  );
  expect(
    terminalClipboardAction(key("v", { metaKey: true }), false, true),
  ).toBe("paste");
  expect(
    terminalClipboardAction(key("c", { ctrlKey: true }), true, true),
  ).toBeUndefined();
  expect(
    terminalClipboardAction(key("v", { ctrlKey: true }), false, true),
  ).toBeUndefined();
  expect(
    terminalClipboardAction(
      key("v", { ctrlKey: true, altKey: true }),
      false,
      false,
    ),
  ).toBeUndefined();
  expect(
    terminalClipboardAction(
      key("v", { ctrlKey: true, isComposing: true }),
      false,
      false,
    ),
  ).toBeUndefined();
});

it("uses native clipboard and xterm paste once, not literal Ctrl+V or direct PTY writes", async () => {
  vi.mocked(readText).mockResolvedValue("first\r\n第二行\n");
  const term = {
    hasSelection: () => false,
    getSelection: () => "",
    paste: vi.fn(),
  };
  const handler = terminalKeyHandler(term, () => true, vi.fn(), false);
  const event = key("v", { ctrlKey: true });
  expect(handler(event)).toBe(false);
  expect(event.defaultPrevented).toBe(true);
  handler(new KeyboardEvent("keyup", { key: "v", ctrlKey: true }));
  handler(key("v", { ctrlKey: true, repeat: true }));
  await vi.waitFor(() =>
    expect(term.paste).toHaveBeenCalledExactlyOnceWith("first\r\n第二行\n"),
  );
  expect(readText).toHaveBeenCalledTimes(1);
});

it("copies the selection at keydown without interrupting, even if selection changes while awaiting", async () => {
  let selection = "selected output";
  const term = {
    hasSelection: () => !!selection,
    getSelection: () => selection,
    paste: vi.fn(),
  };
  const handler = terminalKeyHandler(term, () => true, vi.fn(), false);
  expect(handler(key("c", { ctrlKey: true }))).toBe(false);
  selection = "";
  await vi.waitFor(() =>
    expect(writeText).toHaveBeenCalledWith("selected output"),
  );
  expect(handler(key("c", { ctrlKey: true }))).toBe(true);
});

it("does not paste after focus leaves the terminal, and reports clipboard errors without sending control bytes", async () => {
  let active = true;
  let resolve!: (text: string) => void;
  vi.mocked(readText).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const term = {
    hasSelection: () => false,
    getSelection: () => "",
    paste: vi.fn(),
  };
  const report = vi.fn();
  const handler = terminalKeyHandler(term, () => active, report, false);
  handler(key("v", { ctrlKey: true }));
  await Promise.resolve();
  active = false;
  resolve("private text");
  await Promise.resolve();
  await Promise.resolve();
  expect(term.paste).not.toHaveBeenCalled();
  active = true;
  vi.mocked(readText).mockRejectedValue(new Error("clipboard unavailable"));
  handler(key("v", { ctrlKey: true }));
  await vi.waitFor(() =>
    expect(report).toHaveBeenCalledWith("读取剪贴板失败，请重试"),
  );
  expect(term.paste).not.toHaveBeenCalled();
});
