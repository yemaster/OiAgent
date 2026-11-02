import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReasoningRecord } from "@/components/workspace/ReasoningRecord";
import { Transcript } from "@/components/workspace/Transcript";
import { buildTranscript } from "@/lib/transcript";
import { demoSnapshot } from "@/lib/demo";
import type { Message } from "@/lib/types";

afterEach(() => vi.useRealTimers());
const thought = (text: string, completed = false): Message => ({
  role: "reasoning",
  text,
  timestamp: "2026-11-02T00:00:00Z",
  reasoning: {
    id: "thought",
    startedAt: "2026-11-02T00:00:00Z",
    completed,
    completedAt: completed ? "2026-11-02T00:00:12Z" : null,
  },
});

it("opens current thinking, streams into the same record and closes immediately on completion", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-02T00:00:02Z"));
  const props = { active: true, stoppedAt: "2026-11-02T00:00:12Z" };
  const view = render(
    <ReasoningRecord {...props} message={thought("First")} />,
  );
  expect(
    screen.getByRole("button", { name: "正在思考 · 2 秒" }),
  ).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("First")).toBeVisible();
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByRole("button", { name: "正在思考 · 3 秒" })).toBeVisible();
  view.rerender(
    <ReasoningRecord {...props} message={thought("First and last")} />,
  );
  expect(screen.getByText("First and last")).toBeVisible();
  view.rerender(
    <ReasoningRecord
      {...props}
      visible={false}
      message={thought("First and last")}
    />,
  );
  expect(vi.getTimerCount()).toBe(0);
  view.rerender(
    <ReasoningRecord {...props} visible message={thought("First and last")} />,
  );
  expect(vi.getTimerCount()).toBe(1);
  view.rerender(
    <ReasoningRecord
      {...props}
      active={false}
      message={thought("First and last", true)}
    />,
  );
  expect(screen.getByRole("button", { name: "思考了 12 秒" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(screen.queryByText("First and last")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "思考了 12 秒" }));
  expect(screen.getByText("First and last")).toBeVisible();
  expect(vi.getTimerCount()).toBe(0);
});

it("folds long wrapped text to its first and last visual lines with a text disclosure", () => {
  const height = vi
    .spyOn(HTMLElement.prototype, "scrollHeight", "get")
    .mockReturnValue(240);
  const text = "A long thought that wraps over many lines";
  const view = render(
    <ReasoningRecord message={thought(text)} active stoppedAt="" />,
  );
  expect(view.container.querySelector(".line-clamp-2")).toHaveTextContent(text);
  expect(screen.getByRole("button", { name: "展开全部思考" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "展开全部思考" }));
  expect(view.container.querySelector(".line-clamp-2")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "收起中间内容" }));
  expect(view.container.querySelector(".line-clamp-2")).not.toBeNull();
  height.mockRestore();
});

it("deduplicates streamed deltas and final snapshots and keeps tool records at the top level", () => {
  const records: Message[] = [
    thought(""),
    { ...thought("First"), delta: true },
    { ...thought(" and last"), delta: true },
    { ...thought("", true), delta: true },
    thought("First and last", true),
  ];
  const items = buildTranscript(records);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    key: "message-0",
    message: { text: "First and last", reasoning: { completed: true } },
  });
  const view = render(
    <Transcript
      items={items}
      task={{ ...demoSnapshot.tasks[0], status: "running" }}
      childTasks={[]}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "思考了 12 秒" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(
    screen.queryByRole("button", { name: /思考与运行记录|执行过程/ }),
  ).not.toBeInTheDocument();
  expect(view.container.querySelector(".border-l")).toBeNull();
});
