import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { useTabOrder } from "@/hooks/useTabOrder";
import { TaskTabs } from "@/components/workspace/TaskTabs";
import { demoSnapshot } from "@/lib/demo";
import type { OpenFile } from "@/lib/files";

const tasks = demoSnapshot.tasks.slice(0, 2);
// Use the same raw id as a task to cover collisions across kinds.
const file: OpenFile = {
  id: tasks[0].id,
  project: "/repo",
  path: "main.ts",
  mode: "edit",
  content: "draft",
  saved: "",
  revision: "1",
  loading: false,
  saving: false,
};
const props = () => ({
  tasks,
  files: [file],
  pageTab: { title: "当前任务", onSelect: vi.fn() },
  selected: tasks[0].id,
  onSelect: vi.fn(),
  onClose: vi.fn(),
  onNew: vi.fn(),
  onCloseMany: vi.fn(),
  onSelectFile: vi.fn(),
  onCloseFile: vi.fn(),
});
const keys = () =>
  screen
    .getAllByRole("tab")
    .map((tab) => tab.closest("[data-tab-key]")!.getAttribute("data-tab-key"));
function shift(tab: HTMLElement, direction = "ArrowLeft") {
  fireEvent.keyDown(tab, { key: direction, altKey: true, shiftKey: true });
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps visual order through updates, removes closed keys and appends reopened tabs", () => {
  const { result, rerender } = renderHook(
    ({ available }) => useTabOrder(available),
    {
      initialProps: { available: ["page", "task:a", "file:b"] },
    },
  );
  act(() => result.current.move("file:b", "page"));
  rerender({ available: ["page", "task:a", "task:c", "file:b"] });
  expect(result.current.order).toEqual(["file:b", "page", "task:a", "task:c"]);
  rerender({ available: ["page", "task:a", "task:c"] });
  rerender({ available: ["page", "task:a", "task:c", "file:b"] });
  expect(result.current.order).toEqual(["page", "task:a", "task:c", "file:b"]);
  act(() => result.current.move("missing", "page"));
  expect(result.current.order).toEqual(["page", "task:a", "task:c", "file:b"]);
});

it("reorders all kinds without selecting or closing them and navigates in visual order", async () => {
  const p = props();
  const view = render(<TaskTabs {...p} />);
  const fileTab = screen.getByRole("tab", { name: /main.ts/ });
  fileTab.focus();
  shift(fileTab);
  shift(fileTab);
  shift(fileTab);
  expect(keys()).toEqual([
    `file:${file.id}`,
    "page",
    `task:${tasks[0].id}`,
    `task:${tasks[1].id}`,
  ]);
  expect(fileTab).toHaveFocus();
  expect(screen.getByLabelText("未保存")).toBeInTheDocument();
  expect(p.onSelect).not.toHaveBeenCalled();
  expect(p.onSelectFile).not.toHaveBeenCalled();
  expect(p.onClose).not.toHaveBeenCalled();
  expect(
    screen.getByRole("tab", { name: new RegExp(tasks[0].title) }),
  ).toHaveAttribute("aria-selected", "true");
  shift(screen.getByRole("tab", { name: /当前页面/ }), "ArrowRight");
  view.rerender(
    <TaskTabs
      {...p}
      pageTab={{ ...p.pageTab, title: "历史记录" }}
      tasks={tasks.map((t) => ({ ...t, preview: "updated" }))}
    />,
  );
  expect(keys()).toEqual([
    `file:${file.id}`,
    `task:${tasks[0].id}`,
    "page",
    `task:${tasks[1].id}`,
  ]);
  fireEvent.keyDown(fileTab, { key: "End" });
  expect(p.onSelect).toHaveBeenLastCalledWith(tasks[1].id);
  fireEvent.keyDown(screen.getAllByRole("tab")[3], { key: "Home" });
  expect(p.onSelectFile).toHaveBeenCalledWith(file.id);
  await userEvent.click(
    screen.getByRole("button", { name: `关闭标签：${tasks[0].title}` }),
  );
  expect(p.onClose).toHaveBeenCalledWith(tasks[0].id);
});

it("closes the visually right-hand tabs while excluding the moved page tab", async () => {
  const p = props();
  render(<TaskTabs {...p} />);
  shift(screen.getByRole("tab", { name: /main.ts/ }));
  shift(screen.getByRole("tab", { name: /当前页面/ }), "ArrowRight");
  // task A | page | file | task B
  fireEvent.contextMenu(screen.getAllByRole("tab")[0]);
  await userEvent.click(screen.getByRole("menuitem", { name: "关闭右侧标签" }));
  expect(p.onCloseMany).toHaveBeenCalledWith([
    { kind: "file", id: file.id },
    { kind: "task", id: tasks[1].id },
  ]);
});

function mockGeometry() {
  class PointerEventMock extends MouseEvent {
    pointerId = 1;
    isPrimary = true;
  }
  vi.stubGlobal("PointerEvent", PointerEventMock);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const tab = this.closest("[data-tab-key]");
      const all = Array.from(document.querySelectorAll("[data-tab-key]"));
      const left = tab ? all.indexOf(tab) * 200 : 0;
      const width = tab ? 200 : 800;
      return {
        x: left,
        y: 0,
        left,
        top: 0,
        width,
        height: 40,
        right: left + width,
        bottom: 40,
        toJSON() {},
      };
    },
  );
}
function startDrag(tab: HTMLElement, from: number, to: number) {
  fireEvent.pointerDown(tab, {
    button: 0,
    clientX: from,
    clientY: 20,
    bubbles: true,
  });
  fireEvent.pointerMove(document, { clientX: from + 10, clientY: 20 });
  fireEvent.pointerMove(document, { clientX: to, clientY: 20 });
}

it("drags a file across task and page tabs using the pointer, without activating it", () => {
  mockGeometry();
  const p = props();
  render(<TaskTabs {...p} />);
  startDrag(screen.getByRole("tab", { name: /main.ts/ }), 700, 100);
  fireEvent.pointerUp(document, { clientX: 100, clientY: 20 });
  expect(keys()).toEqual([
    `file:${file.id}`,
    "page",
    `task:${tasks[0].id}`,
    `task:${tasks[1].id}`,
  ]);
  expect(p.onSelectFile).not.toHaveBeenCalled();
});

it("cancels dragging with Escape or when dropped outside the tab strip", () => {
  mockGeometry();
  render(<TaskTabs {...props()} />);
  const initial = keys();
  startDrag(screen.getByRole("tab", { name: /main.ts/ }), 700, 100);
  fireEvent.keyDown(document, { code: "Escape", key: "Escape" });
  expect(keys()).toEqual(initial);
  startDrag(screen.getByRole("tab", { name: /main.ts/ }), 700, 100);
  fireEvent.pointerMove(document, { clientX: 100, clientY: 200 });
  fireEvent.pointerUp(document, { clientX: 100, clientY: 200 });
  expect(keys()).toEqual(initial);
});
