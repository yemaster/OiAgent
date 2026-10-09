import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskTabs } from "@/components/workspace/TaskTabs";
import { FileContextMenu } from "@/components/workspace/FileContextMenu";
import { demoSnapshot } from "@/lib/demo";

describe("workspace context menus", () => {
  it("acts on the right-clicked background tab without selecting or stopping it", async () => {
    const user = userEvent.setup();
    const tasks = demoSnapshot.tasks.slice(0, 3);
    const onSelect = vi.fn(),
      onClose = vi.fn(),
      onCloseMany = vi.fn();
    render(
      <TaskTabs
        tasks={tasks}
        selected={tasks[0].id}
        onSelect={onSelect}
        onClose={onClose}
        onCloseMany={onCloseMany}
        onNew={vi.fn()}
      />,
    );
    fireEvent.contextMenu(screen.getAllByRole("tab")[1]);
    expect(onSelect).not.toHaveBeenCalled();
    await user.click(screen.getByRole("menuitem", { name: "关闭其他标签" }));
    expect(onCloseMany).toHaveBeenCalledWith([
      { kind: "task", id: tasks[0].id },
      { kind: "task", id: tasks[2].id },
    ]);
    expect(onClose).not.toHaveBeenCalled();
  });
  it("opens a renamed file diff with its original path using keyboard context menu", async () => {
    const user = userEvent.setup(),
      open = vi.fn();
    render(
      <FileContextMenu
        project="/repo"
        path="new.ts"
        originalPath="old.ts"
        onOpen={open}
      >
        <button>new.ts</button>
      </FileContextMenu>,
    );
    fireEvent.keyDown(screen.getByRole("button"), {
      key: "F10",
      shiftKey: true,
    });
    await user.click(screen.getByRole("menuitem", { name: "查看工作区改动" }));
    expect(open).toHaveBeenCalledWith("/repo", "new.ts", "diff", "old.ts");
  });
  it("does not offer file-only actions on a directory", () => {
    render(
      <FileContextMenu project="/repo" path="src" directory onToggle={vi.fn()}>
        <button>src</button>
      </FileContextMenu>,
    );
    fireEvent.contextMenu(screen.getByRole("button"));
    expect(screen.getByRole("menuitem", { name: "展开文件夹" })).toBeVisible();
    expect(
      screen.queryByRole("menuitem", { name: "打开文件" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "查看工作区改动" }),
    ).not.toBeInTheDocument();
  });
});
