import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { TodoDrag, TodoDragRow } from "@/components/workspace/TodoDrag";
import { emptyTodo, type Todo } from "@/lib/todos";
afterEach(() => vi.restoreAllMocks());
function rectangle(x: number, y: number, width: number, height: number) {
  return {
    x,
    y,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    width,
    height,
    toJSON() {},
  };
}
it("previews a child drop and saves only after the pointer is released", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const row =
        this.dataset.todoRow ||
        this.dataset.todoTarget ||
        this.closest<HTMLElement>("[data-todo-row]")?.dataset.todoRow;
      if (!row) return rectangle(0, 0, 800, 600);
      const y = row === "a" ? 100 : 200;
      const zone = this.dataset.todoDrop;
      return rectangle(
        0,
        y + (zone === "inside" ? 15 : zone === "after" ? 45 : 0),
        500,
        zone === "inside" ? 30 : zone ? 15 : 60,
      );
    },
  );
  const items: Todo[] = ["a", "b"].map((id) => ({
    ...emptyTodo(),
    id,
    title: id,
    createdAt: "",
    updatedAt: "",
    completedAt: null,
  }));
  const move = vi.fn();
  render(
    <TodoDrag items={items} revision="original" disabled={false} onMove={move}>
      {items.map((item) => (
        <TodoDragRow key={item.id} item={item} context={false}>
          {item.title}
        </TodoDragRow>
      ))}
    </TodoDrag>,
  );
  fireEvent.pointerDown(screen.getByRole("button", { name: "移动计划：a" }), {
    button: 0,
    isPrimary: true,
    pointerId: 1,
    clientX: 20,
    clientY: 130,
  });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 30, clientY: 140 });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 100, clientY: 230 });
  await waitFor(() =>
    expect(screen.getByText("成为「b」的子计划")).toBeInTheDocument(),
  );
  expect(move).not.toHaveBeenCalled();
  fireEvent.pointerUp(document, { pointerId: 1, clientX: 100, clientY: 230 });
  expect(move).toHaveBeenCalledExactlyOnceWith(
    "a",
    { targetId: "b", placement: "inside" },
    "original",
  );
});
