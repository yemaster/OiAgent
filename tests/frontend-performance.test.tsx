import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { Transcript } from "@/components/workspace/Transcript";
import {
  EditorWorkspace,
  EditorPane,
} from "@/components/workspace/EditorWorkspace";
import { TooltipProvider } from "@/components/ui/tooltip";
import { applyTaskUpdates, createTaskUpdateQueue } from "@/lib/taskUpdates";
import { demoSnapshot } from "@/lib/demo";
import type { TranscriptItem } from "@/lib/transcript";
import type { EditorLayout } from "@/lib/editorGroups";
import { createOutputBuffer } from "@/lib/taskOutput";
import { createTranscriptReader } from "@/lib/transcriptCache";

const markdown = vi.hoisted(() => vi.fn());
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => {
    markdown(children);
    return <p>{children}</p>;
  },
}));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("parses only the new Markdown message when streaming into an 80-message transcript", () => {
  const items: TranscriptItem[] = Array.from({ length: 80 }, (_, i) => ({
    kind: "message",
    key: `m-${i}`,
    message: {
      role: i % 2 ? "assistant" : "user",
      text: `message ${i}`,
      timestamp: "t",
    },
  }));
  const props = {
    task: { ...demoSnapshot.tasks[0], status: "completed" as const },
    childTasks: [],
    onOpen: vi.fn(),
  };
  markdown.mockClear();
  const view = render(<Transcript {...props} items={items} />);
  expect(markdown).toHaveBeenCalledTimes(80);
  const added: TranscriptItem = {
    kind: "message",
    key: "new",
    message: { role: "assistant", text: "new output", timestamp: "t" },
  };
  view.rerender(<Transcript {...props} items={[...items, added]} />);
  expect(markdown).toHaveBeenCalledTimes(81);
  expect(screen.getByText("new output")).toBeVisible();
});

it("coalesces 500 streaming events into one update without delaying a waiting state", () => {
  vi.useFakeTimers();
  const commit = vi.fn();
  const queue = createTaskUpdateQueue(commit);
  const base = { ...demoSnapshot.tasks[0], status: "running" as const };
  for (let i = 0; i < 500; i++)
    queue.push({
      ...base,
      preview: `token ${i}`,
      updatedAt: new Date(i + 1).toISOString(),
    });
  expect(commit).not.toHaveBeenCalled();
  vi.advanceTimersByTime(100);
  expect(commit).toHaveBeenCalledExactlyOnceWith(
    [expect.objectContaining({ preview: "token 499" })],
    false,
  );
  queue.push({
    ...base,
    preview: "more",
    updatedAt: new Date(501).toISOString(),
  });
  queue.push({
    ...base,
    status: "waiting",
    updatedAt: new Date(502).toISOString(),
  });
  expect(commit).toHaveBeenLastCalledWith(
    [expect.objectContaining({ status: "waiting" })],
    true,
  );
  queue.push(base);
  queue.dispose();
  vi.advanceTimersByTime(1000);
  expect(commit).toHaveBeenCalledTimes(2);
});

it("keeps historical Markdown unchanged across native output frames", () => {
  const buffer = createOutputBuffer();
  buffer.reset({
    messages: Array.from({ length: 80 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      text: `history ${i}`,
      timestamp: "t",
    })),
    truncated: false,
  });
  const reader = createTranscriptReader();
  const props = {
    task: demoSnapshot.tasks[0],
    childTasks: [],
    onOpen: vi.fn(),
  };
  markdown.mockClear();
  const view = render(
    <Transcript {...props} items={reader(buffer.snapshot().messages)} />,
  );
  expect(markdown).toHaveBeenCalledTimes(80);
  for (let frame = 0; frame < 20; frame++) {
    buffer.push({
      role: "assistant",
      text: "increment ",
      timestamp: "t",
      streamId: "live",
      delta: true,
    });
    view.rerender(
      <Transcript {...props} items={reader(buffer.snapshot().messages)} />,
    );
  }
  expect(markdown).toHaveBeenCalledTimes(100);
  expect(screen.getByText("increment ".repeat(20).trim())).toBeVisible();
});

it("preserves unchanged task references and order while rejecting delayed snapshots", () => {
  const a = {
    ...demoSnapshot.tasks[0],
    id: "a",
    updatedAt: "2026-11-02T10:00:02Z",
  };
  const b = { ...a, id: "b" };
  const tasks = [a, b];
  expect(applyTaskUpdates(tasks, [{ ...a }])).toBe(tasks);
  expect(
    applyTaskUpdates(tasks, [{ ...a, updatedAt: "2026-11-02T10:00:01Z" }]),
  ).toBe(tasks);
  const next = applyTaskUpdates(tasks, [
    { ...b, preview: "changed", updatedAt: "2026-11-02T10:00:03Z" },
  ]);
  expect(next.map((task) => task.id)).toEqual(["a", "b"]);
  expect(next[0]).toBe(a);
  expect(next[1].preview).toBe("changed");
});

it("does not re-render hidden editor panes during unrelated updates and restores the latest props with the draft", () => {
  const rendered = vi.fn();
  const stop = vi.fn();
  function Page({ active, version }: { active: boolean; version: number }) {
    rendered(active, version);
    const [draft, setDraft] = useState("");
    useEffect(() => {
      if (active) return stop;
    }, [active]);
    return (
      <>
        <input
          aria-label="draft"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <p>version {version}</p>
      </>
    );
  }
  function Harness({ active = "page", version = 0 }) {
    const layout: EditorLayout = {
      focused: "g",
      serial: 1,
      root: {
        kind: "group",
        id: "g",
        tabs: ["page", "task:other"],
        active,
        history: [],
      },
    };
    return (
      <TooltipProvider>
        <EditorWorkspace
          layout={layout}
          tabs={{
            tasks: [],
            selected: null,
            onSelect: vi.fn(),
            onClose: vi.fn(),
            onNew: vi.fn(),
            pageTab: { title: "Page", onSelect: vi.fn() },
          }}
          onSelect={vi.fn()}
          onMove={vi.fn()}
          onMerge={vi.fn()}
        >
          <EditorPane tabKey="page">
            <Page active={active === "page"} version={version} />
          </EditorPane>
          <EditorPane tabKey="task:other">
            <p>other</p>
          </EditorPane>
        </EditorWorkspace>
      </TooltipProvider>
    );
  }
  const view = render(<Harness />);
  fireEvent.change(screen.getByRole("textbox", { name: "draft" }), {
    target: { value: "unsent draft" },
  });
  view.rerender(<Harness active="task:other" />);
  expect(stop).toHaveBeenCalledOnce();
  const hiddenRenders = rendered.mock.calls.length;
  for (let version = 1; version <= 20; version++)
    view.rerender(<Harness active="task:other" version={version} />);
  expect(rendered).toHaveBeenCalledTimes(hiddenRenders);
  view.rerender(<Harness version={20} />);
  expect(screen.getByText("version 20")).toBeVisible();
  expect(screen.getByRole("textbox", { name: "draft" })).toHaveValue(
    "unsent draft",
  );
});
