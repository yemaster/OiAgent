import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { call } from "@/lib/api";
import { useAttachments } from "@/hooks/useAttachments";
import { NewTaskPage } from "@/pages/NewTask";
import { ConversationComposer } from "@/components/workspace/ConversationComposer";
import { demoSnapshot } from "@/lib/demo";
import { setSendShortcut } from "@/lib/shortcuts";
import { buildTranscript } from "@/lib/transcript";
import type { Attachment } from "@/lib/types";
vi.mock("@/lib/api", () => ({
  desktop: true,
  call: vi.fn(),
  pickDirectory: vi.fn(),
}));
const file: Attachment = {
  id: "file1",
  name: "说明.txt",
  path: "/app/attachment.txt",
  mime: "application/octet-stream",
  size: 42,
  digest: "digest",
};
beforeEach(() => {
  localStorage.clear();
  setSendShortcut("enter");
  vi.mocked(call).mockReset().mockResolvedValue(demoSnapshot.tasks[0]);
});
it("stages pasted files without touching the prompt and retains successful files on a later failure", async () => {
  vi.mocked(call).mockResolvedValueOnce(file).mockRejectedValueOnce("读取失败");
  const { result } = renderHook(() => useAttachments());
  await act(() =>
    result.current.add([
      new File(["data"], "说明.txt"),
      new File(["other"], "bad.txt"),
    ]),
  );
  expect(result.current.items).toEqual([file]);
  expect(result.current.loading).toBe(false);
  expect(call).toHaveBeenCalledWith("stage_attachment", {
    name: "说明.txt",
    data: "ZGF0YQ==",
  });
});
it("passes the remaining budget so over-limit paths are rejected before copying", async () => {
  vi.mocked(call).mockResolvedValueOnce(file);
  const { result } = renderHook(() => useAttachments());
  await act(() => result.current.add(["/tmp/a.txt", "/tmp/b.txt"]));
  expect(call).toHaveBeenNthCalledWith(1, "stage_attachment", {
    path: "/tmp/a.txt",
    remaining: 20 * 1024 * 1024,
  });
  expect(call).toHaveBeenNthCalledWith(2, "stage_attachment", {
    path: "/tmp/b.txt",
    remaining: 20 * 1024 * 1024 - file.size,
  });
});
it("sends an attachment-only new task and keeps text formatting exact", async () => {
  render(
    <NewTaskPage
      snapshot={demoSnapshot}
      project="/tmp/project"
      seed={{
        ...demoSnapshot.tasks[0],
        project: "/tmp/project",
        prompt: "",
        attachments: [file],
      }}
      onCreated={vi.fn()}
      onSettings={vi.fn()}
      onAgents={vi.fn()}
    />,
  );
  const input = screen.getByRole("textbox", { name: "任务内容" });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() =>
    expect(call).toHaveBeenCalledWith(
      "create_task",
      expect.objectContaining({
        input: expect.objectContaining({ prompt: "", attachments: [file] }),
      }),
    ),
  );
});
it("enables attachment-only continuation and blocks send while staging", () => {
  const sent = vi.fn();
  function Composer() {
    const attachments = useAttachments([file]);
    return (
      <ConversationComposer
        task={demoSnapshot.tasks[0]}
        attachments={attachments}
        busy={false}
        canContinue
        prompt=""
        permission="default"
        onPrompt={vi.fn()}
        onPermission={vi.fn()}
        onSend={sent}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onRetry={vi.fn()}
        onLog={vi.fn()}
      />
    );
  }
  render(<Composer />);
  fireEvent.keyDown(screen.getByRole("textbox", { name: "继续对话" }), {
    key: "Enter",
  });
  expect(sent).toHaveBeenCalledOnce();
  expect(screen.getByText("说明.txt")).toBeVisible();
});
it("does not discard an attachment-only user turn from the transcript", () => {
  expect(
    buildTranscript([
      { role: "user", text: "", timestamp: "", attachments: [file] },
    ]),
  ).toHaveLength(1);
});
