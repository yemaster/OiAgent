import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { FileEditor } from "@/pages/FileEditor";
import { useState } from "react";
import {
  EditorWorkspace,
  EditorPane,
} from "@/components/workspace/EditorWorkspace";
import { initialEditorLayout } from "@/lib/editorGroups";
import type { OpenFile } from "@/lib/files";
vi.mock("@/lib/monaco", () => ({}));
vi.mock("@/lib/api", () => ({ desktop: false, call: vi.fn() }));
vi.mock("@monaco-editor/react", () => ({
  default: ({
    value,
    options,
  }: {
    value: string;
    options: { wordWrap: string; minimap: { enabled: boolean } };
  }) => (
    <textarea
      aria-label="代码正文"
      value={value}
      readOnly
      data-wrap={options.wordWrap}
      data-minimap={String(options.minimap.enabled)}
    />
  ),
  DiffEditor: ({ options }: { options: { renderSideBySide: boolean } }) => (
    <div
      aria-label="差异编辑器"
      data-split={String(options.renderSideBySide)}
    />
  ),
}));
const file: OpenFile = {
  id: "file",
  project: "/repo",
  path: "guide/readme.md",
  content:
    "# Preview title\n[Other](../other.md)\n<script>alert('no')</script>",
  saved: "",
  mode: "edit",
  revision: "r",
  loading: false,
  saving: false,
};
const callbacks = {
  onChange: vi.fn(),
  onSave: vi.fn(),
  onReload: vi.fn(),
  onResolve: vi.fn(),
  onOpen: vi.fn(),
};
beforeEach(() => {
  localStorage.removeItem("oiagent-editor-preferences");
  vi.clearAllMocks();
});
it("keeps breadcrumbs and file actions in the active tab row without leaking hidden file actions", async () => {
  const files = [file, { ...file, id: "other", path: "other.py" }];
  const saved = vi.fn();
  function Workspace() {
    const [current, select] = useState("file:file");
    return (
      <EditorWorkspace
        layout={initialEditorLayout(["file:file", "file:other"], current)}
        onSelect={select}
        onMove={vi.fn()}
        onMerge={vi.fn()}
        tabs={{
          tasks: [],
          files,
          selected: null,
          selectedFile: current.slice(5),
          onSelect: vi.fn(),
          onClose: vi.fn(),
          onNew: vi.fn(),
        }}
      >
        {files.map((entry) => (
          <EditorPane key={entry.id} tabKey={`file:${entry.id}`}>
            <FileEditor
              {...callbacks}
              file={entry}
              onSave={() => saved(entry.id)}
            />
          </EditorPane>
        ))}
      </EditorWorkspace>
    );
  }
  const user = userEvent.setup();
  const view = render(<Workspace />);
  const header = view.container.querySelector("[data-editor-header]")!;
  expect(header).toContainElement(
    await screen.findByRole("navigation", { name: "文件路径" }),
  );
  expect(header).toContainElement(
    screen.getByRole("button", { name: "文件操作" }),
  );
  expect(screen.getAllByRole("button", { name: "文件操作" })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(saved).toHaveBeenLastCalledWith("file");
  await user.click(screen.getByRole("tab", { name: /other.py/ }));
  expect(screen.getAllByRole("navigation", { name: "文件路径" })).toHaveLength(
    1,
  );
  expect(
    screen.getByRole("navigation", { name: "文件路径" }),
  ).toHaveTextContent("other.py");
  expect(
    screen.queryByRole("button", { name: "侧边预览" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(saved).toHaveBeenLastCalledWith("other");
  expect(header).toContainElement(screen.getByRole("button", { name: "保存" }));
});
it("persists editor options across remounts and shares them between open editors", async () => {
  const user = userEvent.setup();
  const view = render(<FileEditor file={file} {...callbacks} />);
  expect(await screen.findByLabelText("代码正文")).toHaveAttribute(
    "data-wrap",
    "off",
  );
  await user.click(screen.getByRole("button", { name: "文件操作" }));
  await user.click(screen.getByRole("menuitemcheckbox", { name: "自动换行" }));
  expect(await screen.findByLabelText("代码正文")).toHaveAttribute(
    "data-wrap",
    "on",
  );
  view.unmount();
  render(
    <FileEditor
      file={{ ...file, id: "other", path: "other.py" }}
      {...callbacks}
    />,
  );
  expect(await screen.findByLabelText("代码正文")).toHaveAttribute(
    "data-wrap",
    "on",
  );
  expect(
    JSON.parse(localStorage.getItem("oiagent-editor-preferences")!),
  ).toMatchObject({ wrap: true });
});
it("opens a live side preview without remounting the editor and resolves document links", async () => {
  const user = userEvent.setup();
  const view = render(<FileEditor file={file} {...callbacks} />);
  const editor = await screen.findByLabelText("代码正文");
  expect(screen.queryByLabelText("Markdown 预览")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "侧边预览" }));
  expect(
    await screen.findByRole("heading", { name: "Preview title" }),
  ).toBeInTheDocument();
  expect(await screen.findByLabelText("代码正文")).toBe(editor);
  expect(
    screen.getByLabelText("Markdown 预览").querySelector("script"),
  ).toBeNull();
  await user.click(screen.getByRole("link", { name: "Other" }));
  expect(callbacks.onOpen).toHaveBeenCalledWith("/repo", "other.md", "edit");
  view.rerender(
    <FileEditor
      file={{ ...file, content: "# Updated preview" }}
      {...callbacks}
    />,
  );
  expect(
    await screen.findByRole("heading", { name: "Updated preview" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "侧边预览" }));
  expect(screen.queryByLabelText("Markdown 预览")).not.toBeInTheDocument();
});
it("offers one run action for supported code and prevents duplicate clicks during launch", async () => {
  let finish!: () => void;
  const run = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <FileEditor
      file={{ ...file, path: "main.cpp" }}
      onRun={run}
      {...callbacks}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "运行文件" }));
  fireEvent.click(screen.getByRole("button", { name: "运行文件" }));
  expect(run).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "运行文件" })).toBeDisabled();
  await act(async () => finish());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "运行文件" })).toBeEnabled(),
  );
});
