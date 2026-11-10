import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import App from "@/App";
import { demoSnapshot } from "@/lib/demo";
import { fileId } from "@/lib/files";
import { initialEditorLayout } from "@/lib/editorGroups";
import { writeWorkspaceSession } from "@/lib/workspaceSession";

vi.mock("@/lib/monaco", () => ({}));
vi.mock("@monaco-editor/react", () => ({
  default: () => <textarea aria-label="代码正文" />,
  DiffEditor: () => <div aria-label="差异编辑器" />,
}));
vi.mock("@/lib/api", async (original) => {
  const api = await original<typeof import("@/lib/api")>();
  return {
    ...api,
    call: (command: string, args?: Record<string, unknown>) =>
      command === "read_project_file"
        ? Promise.resolve({ content: "const value = 1;", revision: "r" })
        : api.call(command, args),
  };
});

it("puts the restored file path and actions in the top page header and clears them on leaving the file", async () => {
  localStorage.setItem("oiagent-onboarded", "true");
  const project = "/workspace/example";
  const id = fileId(project, "src/main.ts", "edit");
  writeWorkspaceSession({
    version: 1,
    page: "tasks",
    project: "all",
    opened: [],
    selected: null,
    selectedFile: id,
    files: [{ id, project, path: "src/main.ts", mode: "edit" }],
    layout: initialEditorLayout(["page", `file:${id}`], `file:${id}`),
  });
  const user = userEvent.setup();
  const view = render(<App />);
  const path = await screen.findByRole("navigation", { name: "文件路径" });
  const header = screen.getByLabelText("页面导航栏");
  expect(header).toBe(screen.getByRole("main").firstElementChild);
  expect(header).toContainElement(path);
  expect(header).toContainElement(
    screen.getByRole("button", { name: "文件操作" }),
  );
  const actions = within(header).getByRole("group", { name: "文件操作栏" });
  const projectMenu = within(header).getByRole("button", {
    name: "项目操作：example",
  });
  const refresh = within(header).getByRole("button", { name: "同步历史记录" });
  expect(
    projectMenu.compareDocumentPosition(actions) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(actions.parentElement?.nextElementSibling).toBe(refresh);
  expect(path).not.toContainElement(actions);
  expect(
    view.container.querySelector("[data-editor-header]"),
  ).not.toContainElement(path);
  expect(
    screen.queryByRole("navigation", { name: "面包屑" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "当前页面：当前任务" }));
  expect(
    within(header).queryByRole("navigation", { name: "文件路径" }),
  ).not.toBeInTheDocument();
  expect(
    within(header).queryByRole("group", { name: "文件操作栏" }),
  ).not.toBeInTheDocument();
  expect(
    within(header).getByRole("navigation", { name: "面包屑" }),
  ).toBeVisible();
});

it("splits live conversations, preserves drafts and closes back to the other visible group", async () => {
  localStorage.setItem("oiagent-onboarded", "true");
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  const [a, b] = demoSnapshot.tasks;
  async function openTask(title: string) {
    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog", { name: /搜索工作区/ });
    await user.clear(within(dialog).getByRole("textbox"));
    await user.type(within(dialog).getByRole("textbox"), title);
    await user.click(
      within(dialog).getByRole("button", { name: new RegExp(title) }),
    );
    await screen.findByRole("heading", { name: title });
  }
  await openTask(a.title);
  await user.type(
    await screen.findByRole("textbox", { name: "继续对话" }),
    "保留这个草稿",
  );
  await openTask(b.title);
  fireEvent.contextMenu(screen.getByRole("tab", { name: new RegExp(a.title) }));
  await user.click(screen.getByRole("menuitem", { name: "移到右侧分栏" }));
  expect(screen.getAllByRole("region", { name: "编辑器分栏" })).toHaveLength(2);
  expect(screen.getAllByRole("textbox", { name: "继续对话" })).toHaveLength(2);
  expect(screen.getByDisplayValue("保留这个草稿")).toBeVisible();
  expect(screen.getByRole("separator", { name: "调整分栏宽度" })).toBeVisible();
  expect(screen.getAllByRole("group", { name: "任务操作栏" })).toHaveLength(1);
  await user.click(
    screen.getByRole("button", { name: `关闭标签：${a.title}` }),
  );
  await waitFor(() =>
    expect(screen.getAllByRole("region", { name: "编辑器分栏" })).toHaveLength(
      1,
    ),
  );
  expect(screen.getByRole("heading", { name: b.title })).toBeVisible();
  expect(screen.getAllByRole("textbox", { name: "继续对话" })).toHaveLength(1);
});
