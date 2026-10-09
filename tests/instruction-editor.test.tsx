import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { InstructionsPage } from "@/pages/Instructions";
import { useFiles } from "@/hooks/useFiles";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({
  desktop: false,
  call: vi.fn(),
  pickDirectory: vi.fn(),
}));
const request = vi.mocked(call);
const instruction = {
  scope: { kind: "codex", project: null },
  id: "AGENTS.md",
};
beforeEach(() => request.mockReset());
it("opens a missing instruction without creating it, then saves through the scoped API", async () => {
  request.mockImplementation(async (command) =>
    command === "save_instruction"
      ? { content: "# Rules", revision: "saved" }
      : { content: "", revision: "missing" },
  );
  const { result } = renderHook(() => useFiles());
  await act(() =>
    result.current.open(
      "/home/.codex",
      "AGENTS.md",
      "edit",
      undefined,
      undefined,
      instruction,
    ),
  );
  expect(request).toHaveBeenCalledWith("read_instruction", instruction);
  expect(request).not.toHaveBeenCalledWith(
    "save_instruction",
    expect.anything(),
  );
  const id = result.current.files[0].id;
  act(() => result.current.update(id, (f) => ({ ...f, content: "# Rules" })));
  await act(() => result.current.save(id));
  expect(request).toHaveBeenCalledWith("save_instruction", {
    ...instruction,
    content: "# Rules",
    expected: "missing",
  });
  expect(result.current.files[0].saved).toBe("# Rules");
});
it("preserves a draft when the instruction is changed by another program", async () => {
  let reads = 0;
  request.mockImplementation(async (command) => {
    if (command === "save_instruction") throw new Error("conflict");
    return ++reads > 2
      ? { content: "external", revision: "new" }
      : { content: "original", revision: "old" };
  });
  const { result } = renderHook(() => useFiles());
  await act(() =>
    result.current.open(
      "/home/.codex",
      "AGENTS.md",
      "edit",
      undefined,
      undefined,
      instruction,
    ),
  );
  const id = result.current.files[0].id;
  act(() => result.current.update(id, (f) => ({ ...f, content: "draft" })));
  await act(() => result.current.save(id));
  await waitFor(() =>
    expect(result.current.files[0].conflict?.content).toBe("external"),
  );
  expect(result.current.files[0].content).toBe("draft");
});
it("keeps unsupported native writes out of the browser preview", async () => {
  const user = userEvent.setup();
  const onOpen = vi.fn();
  render(
    <InstructionsPage
      snapshot={demoSnapshot}
      context={{ kind: "codex", project: "user" }}
      onContext={vi.fn()}
      onOpen={onOpen}
    />,
  );
  expect(screen.getByText("请在桌面版管理指令文件")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "刷新" }));
  expect(request).not.toHaveBeenCalled();
  expect(onOpen).not.toHaveBeenCalled();
});
