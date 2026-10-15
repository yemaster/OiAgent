import { beforeEach, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { call } from "@/lib/api";
import { useNativeMenu } from "@/hooks/useNativeMenu";
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@/lib/api", () => ({
  desktop: true,
  call: vi.fn().mockResolvedValue(undefined),
}));
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
it("routes menu events to the latest workspace and updates available actions", async () => {
  const unlisten = vi.fn();
  const listeners = new Map<string, (event: { payload: string }) => void>();
  vi.mocked(listen).mockImplementation(async (name, handler) => {
    listeners.set(name, handler as (event: { payload: string }) => void);
    return unlisten;
  });
  const first = vi.fn();
  const second = vi.fn();
  const { rerender, unmount } = renderHook(
    ({ handler, canSave }) =>
      useNativeMenu(handler, { canSave, canClose: canSave, canBack: true }),
    { initialProps: { handler: first, canSave: false } },
  );
  await waitFor(() => expect(listeners.has("menu-action")).toBe(true));
  act(() => listeners.get("menu-action")!({ payload: "new-task" }));
  expect(first).toHaveBeenCalledWith("new-task");
  rerender({ handler: second, canSave: true });
  act(() => listeners.get("menu-action")!({ payload: "save-file" }));
  expect(second).toHaveBeenCalledWith("save-file");
  expect(first).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenLastCalledWith("set_menu_state", {
    canSave: true,
    canClose: true,
    canBack: true,
    terminalFocused: false,
    shortcuts: expect.objectContaining({ "new-task": "CmdOrCtrl+N" }),
  });
  const terminal = document.createElement("div");
  terminal.setAttribute("data-terminal-surface", "");
  const input = document.createElement("textarea");
  terminal.append(input);
  document.body.append(terminal);
  await act(async () => input.focus());
  expect(call).toHaveBeenLastCalledWith(
    "set_menu_state",
    expect.objectContaining({ terminalFocused: true }),
  );
  await act(async () => input.blur());
  expect(call).toHaveBeenLastCalledWith(
    "set_menu_state",
    expect.objectContaining({ terminalFocused: false }),
  );
  terminal.remove();
  unmount();
  await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(2));
  act(() => listeners.get("menu-action")!({ payload: "close-tab" }));
  expect(second).toHaveBeenCalledTimes(1);
});

it("updates native bindings and suspends them while recording or composing a conflicting chord", async () => {
  const { setShortcut } = await import("@/lib/shortcuts");
  vi.mocked(listen).mockResolvedValue(vi.fn());
  const { unmount } = renderHook(() =>
    useNativeMenu(vi.fn(), { canSave: true, canClose: true, canBack: true }),
  );
  act(() => setShortcut("search", "Ctrl+Shift+P"));
  expect(call).toHaveBeenLastCalledWith(
    "set_menu_state",
    expect.objectContaining({
      shortcuts: expect.objectContaining({ search: "Ctrl+Shift+P" }),
    }),
  );
  const recorder = document.createElement("button");
  recorder.dataset.shortcutRecorder = "true";
  document.body.append(recorder);
  await act(async () => recorder.focus());
  expect(call).toHaveBeenLastCalledWith(
    "set_menu_state",
    expect.objectContaining({ terminalFocused: true }),
  );
  recorder.remove();
  const input = document.createElement("textarea");
  input.dataset.chatComposer = "";
  document.body.append(input);
  act(() => setShortcut("send", "Ctrl+Shift+P"));
  await act(async () => input.focus());
  expect(call).toHaveBeenLastCalledWith(
    "set_menu_state",
    expect.objectContaining({
      terminalFocused: false,
      shortcuts: expect.objectContaining({ search: "" }),
    }),
  );
  input.remove();
  unmount();
});
