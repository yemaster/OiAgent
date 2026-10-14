import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import { toast } from "sonner";
import { call } from "@/lib/api";
import { useProjectDrop } from "@/hooks/useProjectDrop";
const native = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: native.listen }),
}));
vi.mock("@/lib/api", () => ({ desktop: true, call: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
let event: (value: { payload: DragDropEvent }) => void;
let unlisten: ReturnType<typeof vi.fn>;
function emit(type: "enter" | "drop" | "leave", paths = ["/tmp/project"]) {
  event({
    payload: { type, paths, position: { x: 0, y: 0 } } as DragDropEvent,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  unlisten = vi.fn();
  native.listen.mockImplementation(async (callback) => {
    event = callback;
    return unlisten;
  });
});
it("shows feedback, cancels on leave, and opens the canonical directory only once", async () => {
  let resolve!: (path: string) => void;
  vi.mocked(call).mockImplementation(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  const open = vi.fn();
  const { result } = renderHook(() => useProjectDrop(open, () => false));
  act(() => emit("enter"));
  expect(result.current).toBe(true);
  act(() => emit("leave"));
  expect(result.current).toBe(false);
  expect(call).not.toHaveBeenCalled();
  act(() => {
    emit("enter");
    emit("drop");
    emit("drop");
  });
  expect(result.current).toBe(false);
  expect(call).toHaveBeenCalledExactlyOnceWith("add_project", {
    project: "/tmp/project",
  });
  expect(open).not.toHaveBeenCalled();
  await act(async () => resolve("/private/tmp/project"));
  expect(open).toHaveBeenCalledExactlyOnceWith("/private/tmp/project");
});
it("does not navigate on files, missing paths, multiple items or an open dialog", async () => {
  vi.mocked(call).mockRejectedValue("请选择文件夹");
  const open = vi.fn();
  const { result, rerender } = renderHook(
    ({ blocked }) => useProjectDrop(open, () => blocked),
    { initialProps: { blocked: false } },
  );
  await act(async () => emit("drop", ["/tmp/file.txt"]));
  expect(toast.error).toHaveBeenCalledWith("请选择文件夹");
  expect(open).not.toHaveBeenCalled();
  vi.mocked(call).mockClear();
  act(() => emit("drop", ["/one", "/two"]));
  expect(toast.error).toHaveBeenCalledWith("请一次拖入一个文件夹");
  expect(call).not.toHaveBeenCalled();
  rerender({ blocked: true });
  act(() => {
    emit("enter");
    emit("drop");
  });
  expect(result.current).toBe(false);
  expect(call).not.toHaveBeenCalled();
});
it("cleans up its listener and never navigates after unmount", async () => {
  let resolve!: (path: string) => void;
  vi.mocked(call).mockImplementation(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  const open = vi.fn();
  const view = renderHook(() => useProjectDrop(open, () => false));
  act(() => emit("drop"));
  view.unmount();
  await act(async () => resolve("/tmp/project"));
  expect(open).not.toHaveBeenCalled();
  await waitFor(() => expect(unlisten).toHaveBeenCalledOnce());
});
