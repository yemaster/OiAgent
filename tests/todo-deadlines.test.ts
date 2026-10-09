import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  browserTodos,
  changeBrowserTodo,
  emptyTodo,
  filterTodos,
  deadlineLabel,
  validDueDate,
  todoPrompt,
} from "@/lib/todos";
import { useLocalDate } from "@/hooks/useLocalDate";
beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());
function add(title: string, dueDate: string | null) {
  return changeBrowserTodo("save_todo", {
    item: { ...emptyTodo(), title, dueDate },
    expected: browserTodos().revision,
  });
}
it("persists, edits and clears deadlines, rejecting invalid dates without changing data", () => {
  const first = add("发布", "2028-02-29");
  expect(browserTodos().items[0].dueDate).toBe("2028-02-29");
  for (const date of [
    "2027-02-29",
    "2026-04-31",
    "0000-01-01",
    "2026-1-01",
    "no-date",
  ])
    expect(validDueDate(date)).toBe(false);
  expect(() => add("无效", "2027-02-29")).toThrow();
  expect(browserTodos().revision).toBe(first.revision);
  const updated = changeBrowserTodo("save_todo", {
    item: { ...first.items[0], dueDate: null },
    expected: first.revision,
  });
  expect(updated.items[0].dueDate).toBeNull();
  const legacy = { ...updated.items[0] } as Record<string, unknown>;
  delete legacy.dueDate;
  localStorage.setItem(
    "oiagent-todos",
    JSON.stringify({ ...updated, items: [legacy] }),
  );
  expect(browserTodos().items[0].dueDate).toBeNull();
});
it("orders unfinished plans by deadline and includes deadlines in task prompts", () => {
  add("未定", null);
  add("明天", "2026-10-10");
  const items = add("今天", "2026-10-09").items;
  expect(
    filterTodos(items, false, "", "all", false).map((t) => t.title),
  ).toEqual(["今天", "明天", "未定"]);
  expect(deadlineLabel(items[2], "2026-10-09")).toBe("今天到期");
  expect(deadlineLabel(items[1], "2026-10-09")).toBe("明天到期");
  expect(deadlineLabel(items[2], "2026-10-10")).toContain("已逾期");
  expect(
    deadlineLabel({ ...items[2], completedAt: "done" }, "2026-10-10"),
  ).not.toContain("逾期");
  expect(
    todoPrompt(items[2], [{ ...items[1], parentId: items[2].id }]),
  ).toContain("截止日期：2026-10-10");
});
it("updates the day at midnight and when resuming after sleep", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 9, 23, 59, 59));
  const view = renderHook(() => useLocalDate());
  expect(view.result.current).toBe("2026-10-09");
  act(() => vi.advanceTimersByTime(1200));
  expect(view.result.current).toBe("2026-10-10");
  vi.setSystemTime(new Date(2026, 9, 12, 8));
  act(() => window.dispatchEvent(new Event("focus")));
  expect(view.result.current).toBe("2026-10-12");
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
