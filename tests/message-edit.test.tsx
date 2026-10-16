import { expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { EditMessage } from "@/components/workspace/EditMessage";
import { buildTranscript } from "@/lib/transcript";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({ call: vi.fn(), desktop: true }));
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
