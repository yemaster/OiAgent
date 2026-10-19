import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ConversationFind } from "@/components/workspace/ConversationFind";
import {
  createConversationSearch,
  ConversationSearchContext,
} from "@/lib/conversationSearch";
import { type TranscriptItem } from "@/lib/transcript";
import { Transcript } from "@/components/workspace/Transcript";
import { DetailPage } from "@/pages/Detail";
import { TooltipProvider } from "@/components/ui/tooltip";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
import { setShortcut } from "@/lib/shortcuts";
vi.mock("@/lib/api", () => ({
  call: vi.fn(),
  desktop: true,
  exportText: vi.fn(),
}));
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
const message = (key: string, text: string): TranscriptItem => ({
  kind: "message",
  key,
  message: { role: "assistant", text, timestamp: "t" },
});
const tool = (key: string, nested: TranscriptItem[] = []): TranscriptItem => ({
  kind: "tool",
  key,
  timestamp: "t",
  tool: {
    callId: key,
    name: "Agent",
    input: { description: key },
    output: null,
    state: "completed",
  },
  nested,
});
it("searches the full transcript and nested output without indexing hidden metadata", () => {
  const rows = [
    ...Array.from({ length: 400 }, (_, i) => message(`m${i}`, `Answer ${i}`)),
    tool("one", [message("same", "target")]),
    tool("two", [message("same", "target")]),
  ];
  const search = createConversationSearch();
  expect(search(rows, " ANSWER 0 ")[0].path).toEqual(["m0"]);
  const matches = search(rows, "target");
  expect(matches.map((m) => m.path)).toEqual([
    ["one", "same"],
    ["two", "same"],
  ]);
  expect(new Set(matches.map((m) => m.id)).size).toBe(2);
  expect(search(rows, " ")).toEqual([]);
  const event = tool("cmd");
  if (event.kind === "tool")
    event.tool.output = { stdout: "visible", signature: "secret-signature" };
  expect(search([event], "secret-signature")).toEqual([]);
  expect(search([event], "VISIBLE")).toHaveLength(1);
});
it("navigates matches, retains selection during streaming, and closes on Escape", async () => {
  const onMatch = vi.fn(),
    onClose = vi.fn();
  const rows = [message("a", "target first"), message("b", "target second")];
  const view = render(
    <ConversationFind
      items={rows}
      focusRequest={0}
      onMatch={onMatch}
      onClose={onClose}
    />,
  );
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "target" } });
  await waitFor(() =>
    expect(onMatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: ["a"] }),
    ),
  );
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(screen.getByRole("status")).toHaveTextContent("1 / 2");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onMatch).toHaveBeenLastCalledWith(
    expect.objectContaining({ path: ["b"] }),
  );
  const calls = onMatch.mock.calls.length;
  view.rerender(
    <ConversationFind
      items={[...rows, message("c", "target third")]}
      focusRequest={1}
      onMatch={onMatch}
      onClose={onClose}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("2 / 3");
  expect(screen.getByRole("textbox")).toHaveFocus();
  expect(onMatch).toHaveBeenCalledTimes(calls);
  fireEvent.keyDown(screen.getByRole("textbox"), {
    key: "Enter",
    shiftKey: true,
  });
  expect(screen.getByRole("status")).toHaveTextContent("1 / 3");
  fireEvent.click(screen.getByRole("button", { name: "上一条匹配" }));
  expect(screen.getByRole("status")).toHaveTextContent("3 / 3");
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();
});
it("opens only the selected nested branch and restores collapsed leaves after search", () => {
  const rows = [
    tool("one", [message("same", "first result")]),
    tool("two", [message("same", "second result")]),
  ];
  const match = createConversationSearch()(rows, "second result")[0];
  const transcript = (
    <Transcript
      items={rows}
      task={{ ...demoSnapshot.tasks[0], status: "completed" }}
      childTasks={[]}
      onOpen={vi.fn()}
    />
  );
  const view = render(
    <ConversationSearchContext.Provider value={match}>
      {transcript}
    </ConversationSearchContext.Provider>,
  );
  expect(screen.getByText("second result")).toBeVisible();
  expect(screen.queryByText("first result")).not.toBeInTheDocument();
  expect(
    view.container.querySelectorAll('[data-search-match="true"]'),
  ).toHaveLength(1);
  view.rerender(
    <ConversationSearchContext.Provider value={null}>
      {transcript}
    </ConversationSearchContext.Provider>,
  );
  expect(screen.queryByText("second result")).not.toBeInTheDocument();
});
it("routes find to the focused task, loads old messages, and leaves editors and terminals alone", async () => {
  const tasks = ["left", "right"].map((id) => ({
    ...demoSnapshot.tasks[0],
    id,
    source: "managed",
    status: "completed",
  }));
  const messages = Array.from({ length: 220 }, (_, i) => ({
    role: "user",
    text: `${i === 0 ? "needle" : "message"} ${i}`,
    timestamp: "t",
  }));
  vi.mocked(call).mockImplementation(async (cmd, args) => {
    if (cmd === "get_detail")
      return {
        task: tasks.find((t) => t.id === (args as { id: string }).id),
        messages,
        log: "",
      };
    if (cmd === "task_artifacts") return { files: [], truncated: false };
    return [];
  });
  render(
    <TooltipProvider>
      {tasks.map((task, i) => (
        <div key={task.id} data-testid={task.id}>
          <DetailPage
            task={task}
            tasks={tasks}
            agents={demoSnapshot.agents}
            profiles={[]}
            focused={i === 1}
            onBack={vi.fn()}
            onOpen={vi.fn()}
            onChanged={async () => {}}
            onRetry={vi.fn()}
          />
        </div>
      ))}
    </TooltipProvider>,
  );
  const right = within(screen.getByTestId("right"));
  await right.findByText("message 219");
  expect(right.queryByText("needle 0")).not.toBeInTheDocument();
  act(() => setShortcut("find-conversation", "Ctrl+H"));
  fireEvent.keyDown(window, { key: "h", ctrlKey: true });
  expect(
    within(screen.getByTestId("left")).queryByRole("search"),
  ).not.toBeInTheDocument();
  const input = right.getByRole("textbox", { name: "搜索对话内容" });
  fireEvent.change(input, { target: { value: "needle" } });
  await waitFor(() =>
    expect(right.getByText("needle 0", { selector: "p" })).toBeVisible(),
  );
  expect(
    screen.getByTestId("right").querySelectorAll("[data-conversation-key]")
      .length,
  ).toBeLessThan(180);
  fireEvent.keyDown(input, { key: "Escape" });
  for (const className of ["monaco-editor", "terminal"]) {
    const surface = document.createElement("textarea");
    surface.className = className;
    if (className === "terminal") surface.dataset.terminalSurface = "true";
    document.body.append(surface);
    expect(fireEvent.keyDown(surface, { key: "h", ctrlKey: true })).toBe(true);
    expect(right.queryByRole("search")).not.toBeInTheDocument();
    surface.remove();
  }
});
