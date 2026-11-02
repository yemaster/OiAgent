import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ArchivedChanges } from "@/components/workspace/ArchivedChanges";
import { PatchPreview } from "@/components/workspace/PatchPreview";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({ call: vi.fn() }));
vi.mock("@/lib/clipboard", () => ({ copyText: vi.fn() }));
vi.mock("@/components/workspace/StepChangePreview", () => ({
  default: ({ change }: { change: { after: string } }) => (
    <div>{change.after}</div>
  ),
}));
afterEach(() => vi.useRealTimers());
const message = (text: string) => ({
  role: "tool",
  text: "",
  timestamp: "",
  tool: {
    callId: text,
    name: "Edit",
    input: { file_path: "a.ts", old_string: "before", new_string: text },
    output: "done",
    state: "completed",
  },
});
it("loads earlier diffs independently of the visible transcript and replaces each page", async () => {
  vi.mocked(call).mockImplementation(async (_, args) => ({
    messages: [message(args?.before ? "earlier edit" : "latest edit")],
    total: 40,
    next: args?.before ? null : 10,
    omitted: false,
  }));
  render(
    <ArchivedChanges
      id="task"
      project="/repo"
      active
      live={false}
      fallback={[]}
    />,
  );
  expect(await screen.findByText("latest edit")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "更早改动" }));
  expect(await screen.findByText("earlier edit")).toBeInTheDocument();
  expect(screen.queryByText("latest edit")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "较新改动" }));
  expect(await screen.findByText("latest edit")).toBeInTheDocument();
  expect(call).toHaveBeenCalledWith("task_changes", { id: "task", before: 10 });
});
it("stops polling and releases archived pages while hidden", async () => {
  vi.useFakeTimers();
  vi.mocked(call).mockReset();
  vi.mocked(call).mockResolvedValue({
    messages: [message("latest edit")],
    total: 1,
    next: null,
    omitted: false,
  });
  const page = (active: boolean) => (
    <ArchivedChanges
      id="task"
      project="/repo"
      active={active}
      live
      fallback={[]}
    />
  );
  const view = render(page(true));
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  view.rerender(page(false));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(call).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("latest edit")).not.toBeInTheDocument();
});
it("renders patch line numbers accurately and bounds the number of mounted rows", async () => {
  const patch =
    "@@ -10,1 +20,900 @@\n-old\n" +
    Array.from({ length: 900 }, (_, i) => `+new ${i}`).join("\n");
  render(<PatchPreview patch={patch} />);
  expect(screen.getAllByLabelText("原行号")).toHaveLength(400);
  expect(screen.getAllByLabelText("原行号")[1]).toHaveTextContent("10");
  expect(screen.getAllByLabelText("新行号")[2]).toHaveTextContent("20");
  fireEvent.click(screen.getByRole("button", { name: "下一段" }));
  expect(screen.queryByText("-old")).not.toBeInTheDocument();
  expect(screen.getAllByLabelText("新行号")[0]).toHaveTextContent("418");
});
it("shows load errors and retries without silently presenting a complete archive", async () => {
  vi.mocked(call)
    .mockRejectedValueOnce(new Error("unavailable"))
    .mockResolvedValue({
      messages: [message("recovered")],
      total: 1,
      next: null,
      omitted: false,
    });
  render(
    <ArchivedChanges
      id="task"
      project="/repo"
      active
      live={false}
      fallback={[]}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("unavailable");
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
});

it("distinguishes patch headers from deleted text beginning with dashes inside a hunk", () => {
  render(
    <PatchPreview
      patch={"--- a/file\n+++ b/file\n@@ -1,1 +1,1 @@\n--- old\n+++ new"}
    />,
  );
  expect(screen.getAllByLabelText("原行号")[3]).toHaveTextContent("1");
  expect(screen.getAllByLabelText("新行号")[4]).toHaveTextContent("1");
});

it("opens the file selected in the summary card after history loads", async () => {
  const second = message("selected file diff");
  second.tool.input.file_path = "b.ts";
  vi.mocked(call).mockResolvedValue({
    messages: [message("first file diff"), second],
    total: 2,
    next: null,
    omitted: false,
  });
  render(
    <ArchivedChanges
      id="selected-task"
      project="/repo"
      initialPath="b.ts"
      active
      live={false}
      fallback={[]}
    />,
  );
  expect(await screen.findByText("selected file diff")).toBeVisible();
  expect(screen.queryByText("first file diff")).not.toBeInTheDocument();
});
