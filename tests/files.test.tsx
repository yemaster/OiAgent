import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFiles } from "@/hooks/useFiles";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({ desktop: false, call: vi.fn() }));
const disk = new Map<string, { content: string; revision: string }>();
beforeEach(() => {
  disk.clear();
  disk.set("a.ts", { content: "const a = 1;", revision: "1" });
  disk.set("b.ts", { content: "const b = 2;", revision: "2" });
  vi.mocked(call).mockImplementation(async (command, args) => {
    const path = String(args?.path),
      file = disk.get(path)!;
    if (command === "read_project_file") return { ...file };
    if (command === "save_project_file") {
      if (args?.revision !== file.revision) throw new Error("磁盘文件已修改");
      const saved = {
        content: String(args.content),
        revision: `${file.revision}+1`,
      };
      disk.set(path, saved);
      return saved;
    }
    throw new Error(command);
  });
});
describe("file editing workspace", () => {
  it("retains unsaved content across tabs and only saves after explicit action", async () => {
    const { result } = renderHook(() => useFiles());
    await act(async () => {
      await result.current.open("/project", "a.ts");
    });
    const a = result.current.active!.id;
    act(() =>
      result.current.update(a, (f) => ({ ...f, content: "const a = 3;" })),
    );
    await act(async () => {
      await result.current.open("/project", "b.ts");
    });
    act(() => result.current.select(a));
    expect(result.current.active?.content).toBe("const a = 3;");
    expect(disk.get("a.ts")?.content).toBe("const a = 1;");
    act(() => result.current.close(a));
    expect(result.current.closing).toBe(a);
    expect(result.current.files).toHaveLength(2);
    await act(async () => {
      await result.current.save(a);
    });
    expect(disk.get("a.ts")?.content).toBe("const a = 3;");
    act(() => result.current.close(a));
    expect(result.current.files).toHaveLength(1);
  });
  it("preserves both versions when the Agent edits a dirty file on disk", async () => {
    const { result } = renderHook(() => useFiles());
    await act(async () => {
      await result.current.open("/project", "a.ts");
    });
    const id = result.current.active!.id;
    act(() =>
      result.current.update(id, (f) => ({ ...f, content: "my draft" })),
    );
    disk.set("a.ts", { content: "Agent change", revision: "external" });
    await act(async () => {
      await result.current.save(id);
    });
    await waitFor(() =>
      expect(result.current.active?.conflict?.content).toBe("Agent change"),
    );
    expect(result.current.active?.content).toBe("my draft");
    expect(disk.get("a.ts")?.content).toBe("Agent change");
  });
});
