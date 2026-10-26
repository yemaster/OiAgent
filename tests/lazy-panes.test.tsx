import { lazy, useEffect, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  EditorPane,
  EditorWorkspace,
} from "@/components/workspace/EditorWorkspace";
import { initialEditorLayout, moveEditorTab } from "@/lib/editorGroups";

vi.mock("@/components/workspace/TaskTabs", () => ({ TaskTabs: () => null }));
const tabs = {
  tasks: [],
  selected: null,
  onSelect: vi.fn(),
  onClose: vi.fn(),
  onNew: vi.fn(),
};

it("loads a tab on its first activation, preserves drafts and isolates loading to its own split", async () => {
  const mounted = vi.fn();
  function Draft() {
    const [text, setText] = useState("");
    useEffect(() => {
      mounted();
    }, []);
    return (
      <input
        aria-label="草稿"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    );
  }
  let finish!: (module: { default: typeof Draft }) => void;
  const load = vi.fn(
    () =>
      new Promise<{ default: typeof Draft }>((resolve) => {
        finish = resolve;
      }),
  );
  const LazyDraft = lazy(load);
  const keys = ["page", "task:one"];
  let layout = initialEditorLayout(keys, "page");
  function Workspace() {
    return (
      <EditorWorkspace
        layout={layout}
        tabs={tabs}
        onSelect={vi.fn()}
        onMove={vi.fn()}
        onMerge={vi.fn()}
      >
        <EditorPane tabKey="page">
          <p>当前页面</p>
        </EditorPane>
        <EditorPane tabKey="task:one">
          <LazyDraft />
        </EditorPane>
      </EditorWorkspace>
    );
  }
  const view = render(<Workspace />);
  expect(load).not.toHaveBeenCalled();
  layout = moveEditorTab(layout, "task:one", "group-0", "right");
  view.rerender(<Workspace />);
  expect(load).toHaveBeenCalledTimes(1);
  expect(screen.getByText("当前页面")).toBeVisible();
  expect(screen.getByRole("status", { name: "正在加载" })).toBeVisible();
  await act(async () => finish({ default: Draft }));
  fireEvent.change(screen.getByRole("textbox", { name: "草稿" }), {
    target: { value: "保留内容" },
  });
  layout = initialEditorLayout(keys, "page");
  view.rerender(<Workspace />);
  expect(screen.queryByRole("textbox", { name: "草稿" })).toBeNull();
  layout = initialEditorLayout(keys, "task:one");
  view.rerender(<Workspace />);
  expect(screen.getByRole("textbox", { name: "草稿" })).toHaveValue("保留内容");
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledTimes(1);
});
