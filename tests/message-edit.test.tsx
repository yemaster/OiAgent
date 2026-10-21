import { useState } from "react";
import { Transcript } from "@/components/workspace/Transcript";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { EditMessage } from "@/components/workspace/EditMessage";
import { buildTranscript } from "@/lib/transcript";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({ call: vi.fn(), desktop: true }));
beforeEach(() => {
  vi.mocked(call).mockReset();
});
const detail = {
  task: demoSnapshot.tasks[0],
  revision: "revision",
  log: "",
  messages: [{ role: "user", text: "original", timestamp: "t" }],
};
it("preserves source indices across metadata filtering", () => {
  const timeline = buildTranscript([
    {
      role: "user",
      text: "<environment_context>metadata</environment_context>",
      timestamp: "t",
    },
    detail.messages[0],
  ]);
  const message = timeline.find(
    (item) => item.kind === "message" && item.message.text === "original",
  );
  expect(message?.kind === "message" && message.message.sourceIndex).toBe(1);
});
it("keeps file restore off and submits the exact revision with an idempotency key", async () => {
  vi.mocked(call).mockImplementation(async (command) =>
    command === "prepare_message_edit"
      ? {
          rewind: { files: ["/project/a"], token: "preview" },
          rewindUnavailable: null,
        }
      : { task: detail.task, launchError: null },
  );
  const saved = vi.fn();
  render(
    <EditMessage
      detail={detail}
      index={0}
      hasUnsavedFiles={false}
      onClose={vi.fn()}
      onSaved={saved}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "保存并发送" })).toBeEnabled(),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "文件恢复" }));
  expect(screen.getByRole("switch")).not.toBeChecked();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "edited" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存并发送" }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(call).toHaveBeenCalledWith("edit_message", {
    input: expect.objectContaining({
      revision: "revision",
      index: 0,
      text: "edited",
      mode: "branch",
      rewindToken: null,
      requestId: expect.any(String),
    }),
  });
});
it("blocks file restore while editor buffers are unsaved", async () => {
  vi.mocked(call).mockResolvedValue({
    rewind: { files: ["/project/a"], token: "preview" },
    rewindUnavailable: null,
  });
  render(
    <EditMessage
      detail={detail}
      index={0}
      hasUnsavedFiles
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "文件恢复" }));
  await screen.findByText("请先保存或关闭未保存的文件");
  expect(screen.getByRole("switch")).toBeDisabled();
});

it("loads the native file preview only when restore is requested", async () => {
  vi.mocked(call).mockReset();
  vi.mocked(call).mockImplementation(async (_command, args) =>
    args?.inspectFiles
      ? {
          rewind: { files: ["/project/a"], token: "checked" },
          rewindUnavailable: null,
        }
      : { rewind: null, rewindUnavailable: null },
  );
  render(
    <EditMessage
      detail={detail}
      index={0}
      hasUnsavedFiles={false}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "文件恢复" }));
  await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
  expect(call).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("switch"));
  await screen.findByRole("list", { name: "待恢复文件" });
  expect(call).toHaveBeenLastCalledWith(
    "prepare_message_edit",
    expect.objectContaining({ inspectFiles: true, revision: "revision" }),
  );
  expect(screen.getByRole("switch")).toBeChecked();
});

function InlineHarness() {
  const [editing, setEditing] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(true);
  return (
    <>
      <button onClick={() => setVisible((value) => !value)}>
        切换历史窗口
      </button>
      <Transcript
        items={visible ? buildTranscript(detail.messages) : []}
        task={detail.task}
        childTasks={[]}
        onOpen={vi.fn()}
        onEditMessage={setEditing}
        editing={
          editing === null ? undefined : { index: editing, anchor: setAnchor }
        }
      />
      {editing !== null && (
        <EditMessage
          target={anchor}
          detail={detail}
          index={editing}
          hasUnsavedFiles={false}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
    </>
  );
}
it("replaces only the selected message with an inline composer and cancels without changing history", async () => {
  vi.mocked(call).mockResolvedValue({ rewind: null, rewindUnavailable: null });
  render(<InlineHarness />);
  fireEvent.click(screen.getByRole("button", { name: "编辑消息" }));
  const input = await screen.findByRole("textbox", { name: "消息内容" });
  expect(input.closest('[aria-label="你的消息"]')).not.toBeNull();
  expect(input).toHaveFocus();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    input.closest('[aria-label="你的消息"]')?.querySelector(".markdown"),
  ).toBeNull();
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  fireEvent.change(input, { target: { value: "edited\n\n- item" } });
  fireEvent.keyDown(input, { key: "Escape", isComposing: true });
  expect(screen.getByRole("textbox")).toBeInTheDocument();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getByText("original")).toBeVisible();
  expect(
    vi.mocked(call).mock.calls.some(([command]) => command === "edit_message"),
  ).toBe(false);
});
it("retains the draft and request identity when history windowing temporarily removes the editor", async () => {
  vi.mocked(call).mockImplementation(async (command) => {
    if (command === "prepare_message_edit")
      return { rewind: null, rewindUnavailable: null };
    throw new Error("响应丢失");
  });
  render(<InlineHarness />);
  fireEvent.click(screen.getByRole("button", { name: "编辑消息" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "保存并发送" })).toBeEnabled(),
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "edited\n\n```ts\nconst a = 1\n```" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存并发送" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "切换历史窗口" }));
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "切换历史窗口" }));
  expect(screen.getByRole("textbox")).toHaveValue(
    "edited\n\n```ts\nconst a = 1\n```",
  );
  fireEvent.click(screen.getByRole("button", { name: "保存并发送" }));
  await waitFor(() =>
    expect(
      vi
        .mocked(call)
        .mock.calls.filter(([command]) => command === "edit_message"),
    ).toHaveLength(2),
  );
  const edits = vi
    .mocked(call)
    .mock.calls.filter(([command]) => command === "edit_message");
  expect(edits[0][1]).toEqual(edits[1][1]);
  expect(
    vi
      .mocked(call)
      .mock.calls.filter(([command]) => command === "prepare_message_edit"),
  ).toHaveLength(1);
});
it("keeps cancel disabled while a save is in flight and sends only once", async () => {
  vi.mocked(call).mockImplementation(async (command) =>
    command === "prepare_message_edit"
      ? { rewind: null, rewindUnavailable: null }
      : new Promise(() => {}),
  );
  const close = vi.fn();
  render(
    <EditMessage
      detail={detail}
      index={0}
      hasUnsavedFiles={false}
      onClose={close}
      onSaved={vi.fn()}
    />,
  );
  const send = screen.getByRole("button", { name: "保存并发送" });
  await waitFor(() => expect(send).toBeEnabled());
  fireEvent.click(send);
  fireEvent.click(send);
  expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
  expect(
    vi
      .mocked(call)
      .mock.calls.filter(([command]) => command === "edit_message"),
  ).toHaveLength(1);
});

it("blocks a prepared restore if unsaved files appear before submitting", async () => {
  vi.mocked(call).mockResolvedValue({
    rewind: { files: ["/project/a"], token: "checked" },
    rewindUnavailable: null,
  });
  const props = { detail, index: 0, onClose: vi.fn(), onSaved: vi.fn() };
  const view = render(<EditMessage {...props} hasUnsavedFiles={false} />);
  fireEvent.click(screen.getByRole("button", { name: "文件恢复" }));
  await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
  fireEvent.click(screen.getByRole("switch"));
  expect(screen.getByRole("list", { name: "待恢复文件" })).toBeVisible();
  view.rerender(<EditMessage {...props} hasUnsavedFiles />);
  const send = screen.getByRole("button", { name: "保存并发送" });
  expect(send).toBeDisabled();
  fireEvent.click(send);
  expect(
    vi.mocked(call).mock.calls.some(([command]) => command === "edit_message"),
  ).toBe(false);
});
