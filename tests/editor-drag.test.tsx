import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  EditorPane,
  EditorWorkspace,
} from "@/components/workspace/EditorWorkspace";
import { useEditorGroups } from "@/hooks/useEditorGroups";
import { demoSnapshot } from "@/lib/demo";

const moves = vi.fn();
function Harness() {
  const [current, select] = useState("task:a");
  const editors = useEditorGroups(["page", "task:a"], current);
  return (
    <EditorWorkspace
      layout={editors.layout}
      onSelect={select}
      onMerge={editors.merge}
      onMove={(key, group, side, before) => {
        moves(key, group, side, before);
        editors.move(key, group, side, before);
        if (
          side ||
          !before ||
          !editors.groups.find((g) => g.id === group)?.tabs.includes(key)
        )
          select(key);
      }}
      tabs={{
        tasks: [{ ...demoSnapshot.tasks[0], id: "a", title: "Task A" }],
        pageTab: { title: "首页", onSelect: () => select("page") },
        selected: "a",
        onSelect: () => select("task:a"),
        onClose: vi.fn(),
        onNew: vi.fn(),
      }}
    >
      <EditorPane tabKey="page">
        <p>Home</p>
      </EditorPane>
      <EditorPane tabKey="task:a">
        <textarea aria-label="Draft" defaultValue="unsaved" />
      </EditorPane>
    </EditorWorkspace>
  );
}
function geometry() {
  class PointerEventMock extends MouseEvent {
    pointerId = 1;
    isPrimary = true;
  }
  vi.stubGlobal("PointerEvent", PointerEventMock);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.getBoundingClientRect().width;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.getBoundingClientRect().height;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.getBoundingClientRect().left;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.getBoundingClientRect().top;
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const group = this.closest("[data-editor-group]");
      const groups = Array.from(
        document.querySelectorAll("[data-editor-group]"),
      );
      const width = group ? 1000 / groups.length : 1000;
      let left = group ? groups.indexOf(group) * width : 0,
        top = 0,
        w = width,
        height = 600;
      const tab = this.closest("[data-tab-key]");
      if (this.hasAttribute("data-panel")) {
        left = this.id.endsWith("first") ? 0 : 500;
        w = 500;
      } else if (this.getAttribute("role") === "separator") {
        left = 498;
        w = 4;
      } else if (tab) {
        left +=
          Array.from(group!.querySelectorAll("[data-tab-key]")).indexOf(tab) *
          200;
        w = 200;
        height = 42;
      } else if (
        this.hasAttribute("data-editor-header") ||
        this.getAttribute("role") === "tablist"
      )
        height = 42;
      else if (this.hasAttribute("data-editor-drop")) {
        const side = this.getAttribute("data-editor-drop");
        top = 42;
        height = 558;
        if (side === "left" || side === "right") {
          w /= 4;
          if (side === "right") left += width * 0.75;
        } else {
          left += width / 4;
          w /= 2;
          if (side === "top") height /= 4;
          else if (side === "bottom") {
            top += height * 0.75;
            height /= 4;
          } else {
            top += height / 4;
            height /= 2;
          }
        }
      }
      return {
        x: left,
        y: top,
        left,
        top,
        width: w,
        height,
        right: left + w,
        bottom: top + height,
        toJSON() {},
      };
    },
  );
}
async function drag(
  tab: HTMLElement,
  x: number,
  destinationX: number,
  destinationY: number,
) {
  fireEvent.pointerDown(tab, {
    button: 0,
    clientX: x,
    clientY: 20,
    bubbles: true,
  });
  fireEvent.pointerMove(document, { clientX: x + 10, clientY: 20 });
  fireEvent.pointerMove(document, {
    clientX: destinationX,
    clientY: destinationY,
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  fireEvent.pointerMove(document, {
    clientX: destinationX,
    clientY: destinationY,
  });
  fireEvent.pointerUp(document, {
    clientX: destinationX,
    clientY: destinationY,
  });
}
afterEach(() => {
  moves.mockClear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("drags to an edge to split, then into another group's body to merge without remounting the editor", async () => {
  geometry();
  render(<Harness />);
  const draft = screen.getByRole("textbox", { name: "Draft" });
  fireEvent.change(draft, { target: { value: "keep unsaved text" } });
  await drag(screen.getByRole("tab", { name: /Task A/ }), 300, 950, 300);
  await waitFor(() =>
    expect(screen.getAllByRole("region", { name: "编辑器分栏" })).toHaveLength(
      2,
    ),
  );
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
  expect(draft).toHaveValue("keep unsaved text");
  expect(screen.getByRole("separator", { name: "调整分栏宽度" })).toBeVisible();
  const separator = screen.getByRole("separator", { name: "调整分栏宽度" });
  const initialSize = Number(separator.getAttribute("aria-valuenow"));
  fireEvent.keyDown(separator, { key: "ArrowRight" });
  await waitFor(() =>
    expect(Number(separator.getAttribute("aria-valuenow"))).toBeGreaterThan(
      initialSize,
    ),
  );
  const keyboardSize = Number(separator.getAttribute("aria-valuenow"));
  fireEvent.pointerDown(separator, { button: 0, clientX: 500, clientY: 300 });
  fireEvent.pointerMove(document, { clientX: 650, clientY: 300, buttons: 1 });
  fireEvent.pointerUp(document, { clientX: 650, clientY: 300 });
  await waitFor(() =>
    expect(Number(separator.getAttribute("aria-valuenow"))).toBeGreaterThan(
      keyboardSize,
    ),
  );

  await drag(screen.getByRole("tab", { name: /Task A/ }), 600, 250, 300);
  expect(moves.mock.calls).toEqual([
    ["task:a", "group-0", "right", undefined],
    ["task:a", "group-0", undefined, undefined],
  ]);
  await waitFor(() =>
    expect(screen.getAllByRole("region", { name: "编辑器分栏" })).toHaveLength(
      1,
    ),
  );
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
  expect(draft).toHaveValue("keep unsaved text");
});

it("cancels a split with Escape", () => {
  geometry();
  render(<Harness />);
  const tab = screen.getByRole("tab", { name: /Task A/ });
  fireEvent.pointerDown(tab, { button: 0, clientX: 300, clientY: 20 });
  fireEvent.pointerMove(document, { clientX: 310, clientY: 20 });
  fireEvent.pointerMove(document, { clientX: 950, clientY: 300 });
  fireEvent.keyDown(document, { code: "Escape", key: "Escape" });
  expect(screen.getAllByRole("region", { name: "编辑器分栏" })).toHaveLength(1);
});
