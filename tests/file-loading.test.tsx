import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useFiles } from "@/hooks/useFiles";
import { fileId, type FileContent } from "@/lib/files";
import { call } from "@/lib/api";

vi.mock("@/lib/api", () => ({ call: vi.fn(), desktop: false }));
const restored = ["a.ts", "b.ts", "c.ts"].map((path) => ({
  id: fileId("/repo", path, "edit"),
  project: "/repo",
  path,
  mode: "edit" as const,
}));
const [a, b, c] = restored.map((f) => f.id);
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(call)
    .mockReset()
    .mockImplementation(async (_command, args) => ({
      content: String(args?.path),
      revision: "1",
    }));
});
afterEach(() => vi.useRealTimers());

it("restores metadata without reading hidden tabs and loads every visible split once", async () => {
  const { result } = renderHook(() => useFiles(restored, a, true));
  expect(call).not.toHaveBeenCalled();
  expect(result.current.files).toHaveLength(3);
  await act(async () => result.current.setVisible([b, c]));
  expect(vi.mocked(call).mock.calls.map(([, args]) => args?.path)).toEqual([
    "b.ts",
    "c.ts",
  ]);
  expect(result.current.files[0].unloaded).toBe(true);
  expect(result.current.files[1].content).toBe("b.ts");
  await act(async () => result.current.setVisible([b]));
  await act(async () => result.current.setVisible([b, c]));
  expect(call).toHaveBeenCalledTimes(2);
});

it("releases idle clean buffers while retaining dirty, conflicting and visible buffers", async () => {
  const { result } = renderHook(() => useFiles(restored, a, true));
  await act(async () => result.current.setVisible([a, b, c]));
  act(() =>
    result.current.update(a, (file) => ({ ...file, content: "unsaved draft" })),
  );
  act(() =>
    result.current.update(c, (file) => ({
      ...file,
      conflict: { content: "Agent edit", revision: "2" },
    })),
  );
  await act(async () => result.current.setVisible([]));
  await act(async () => vi.advanceTimersByTimeAsync(35_000));
  expect(result.current.files[0].content).toBe("unsaved draft");
  expect(result.current.files[1]).toMatchObject({
    content: "",
    unloaded: true,
  });
  expect(result.current.files[2].conflict?.content).toBe("Agent edit");
  vi.mocked(call).mockClear();
  await act(async () => result.current.setVisible([b]));
  expect(call).toHaveBeenCalledTimes(1);
  expect(result.current.files[1]).toMatchObject({
    content: "b.ts",
    unloaded: false,
  });
  await act(async () => vi.advanceTimersByTimeAsync(35_000));
  expect(result.current.files[1].unloaded).toBe(false);
});

it("does not let a closed tab's pending read overwrite a reopened file", async () => {
  let finish!: (file: FileContent) => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise<FileContent>((resolve) => {
        finish = resolve;
      }),
  );
  const { result } = renderHook(() => useFiles(restored, a, true));
  await act(async () => result.current.setVisible([a]));
  act(() => result.current.close(a));
  await act(async () => {
    await result.current.openInEditor("/repo", "a.ts");
  });
  act(() =>
    result.current.update(a, (file) => ({ ...file, content: "new draft" })),
  );
  await act(async () => finish({ content: "stale read", revision: "old" }));
  expect(result.current.files.find((file) => file.id === a)?.content).toBe(
    "new draft",
  );
});

it("deduplicates slow reads and does not poll while the window is hidden", async () => {
  let finish!: (file: FileContent) => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise<FileContent>((resolve) => {
        finish = resolve;
      }),
  );
  const { result } = renderHook(() => useFiles(restored, a, true));
  await act(async () => result.current.setVisible([a]));
  await act(async () => result.current.setVisible([]));
  await act(async () => result.current.setVisible([a]));
  await act(async () => vi.advanceTimersByTimeAsync(12_000));
  expect(call).toHaveBeenCalledTimes(1);
  await act(async () => finish({ content: "a.ts", revision: "1" }));
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  try {
    await act(async () => vi.advanceTimersByTimeAsync(12_000));
    expect(call).toHaveBeenCalledTimes(1);
    hidden.mockReturnValue(false);
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(call).toHaveBeenCalledTimes(2);
  } finally {
    hidden.mockRestore();
  }
});
