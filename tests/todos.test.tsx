import { beforeEach, expect, it } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "@/App";
import {
  browserTodos,
  changeBrowserTodo,
  emptyTodo,
  filterTodos,
  taskFromTodo,
} from "@/lib/todos";
import { demoSnapshot } from "@/lib/demo";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("oiagent-onboarded", "true");
});
function add(title: string, extra = {}) {
  return changeBrowserTodo("save_todo", {
    item: { ...emptyTodo(), title, ...extra },
    expected: browserTodos().revision,
  });
}
const rail = () => within(screen.getByRole("navigation", { name: "工具栏" }));
const sidebar = () =>
  within(screen.getByRole("complementary", { name: "侧边导航" }));

it("persists edits, completion and recovery, and rejects stale or corrupt writes", () => {
  const first = add("修复登录", {
    notes: "包含回归验证",
    project: "/work/app",
    important: true,
  });
  const id = first.items[0].id;
  const done = changeBrowserTodo("complete_todo", {
    id,
    completed: true,
    expected: first.revision,
  });
  expect(browserTodos().items[0].completedAt).not.toBeNull();
  expect(() =>
    changeBrowserTodo("remove_todo", { id, expected: first.revision }),
  ).toThrow("已修改");
  const edited = changeBrowserTodo("save_todo", {
    item: { ...done.items[0], title: "检查登录" },
    expected: done.revision,
  });
  expect(edited.items[0].completedAt).toBe(done.items[0].completedAt);
  const recovered = changeBrowserTodo("complete_todo", {
    id,
    completed: false,
    expected: edited.revision,
  });
  expect(recovered.items[0].completedAt).toBeNull();
  expect(
    filterTodos(recovered.items, false, "回归", "/work/app", true),
  ).toHaveLength(1);
  expect(filterTodos(recovered.items, true, "", "all", false)).toHaveLength(0);
  expect(() => add(" ")).toThrow("名称");
  expect(() => add("名称", { notes: "字".repeat(12000) })).toThrow("32 KB");
  const removed = changeBrowserTodo("remove_todo", {
    id,
    expected: recovered.revision,
  });
  expect(removed.items).toHaveLength(0);
  localStorage.setItem("oiagent-todos", "corrupt");
  expect(() => add("新计划")).toThrow();
  expect(localStorage.getItem("oiagent-todos")).toBe("corrupt");
});

it("builds a safe task draft and handles an already released temporary project", () => {
  const item = add("检查接口", { notes: "补充超时测试", project: "/work/temp" })
    .items[0];
  const draft = taskFromTodo(
    {
      ...demoSnapshot,
      temporaryProjects: [
        {
          id: "temp",
          path: "/work/temp",
          createdAt: "",
          status: "cleaned",
          cleanupAfter: null,
        },
      ],
    },
    item,
  );
  expect(draft).toMatchObject({
    title: "检查接口",
    prompt: "检查接口\n\n补充超时测试",
    dir: "",
    temporary: true,
    resume: false,
    providerId: "local",
    mode: "agent",
  });
  expect(item.completedAt).toBeNull();
});

it("adds, edits and fills a plan into the task page, then returns without completing it", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  await user.click(rail().getByRole("button", { name: "TODO List" }));
  await waitFor(() =>
    expect(screen.getByLabelText("新计划名称")).toBeEnabled(),
  );
  await user.type(screen.getByLabelText("新计划名称"), "修复登录{Enter}");
  await user.click(
    await screen.findByRole("button", { name: "编辑计划：修复登录" }),
  );
  await user.type(screen.getByLabelText("备注"), "覆盖会话过期的情况");
  await user.type(screen.getByLabelText("项目目录（可选）"), "/work/login");
  await user.click(screen.getByRole("button", { name: "保存计划" }));
  await waitFor(() =>
    expect(screen.queryByLabelText("备注")).not.toBeInTheDocument(),
  );
  await user.click(
    screen.getByRole("button", { name: "创建任务", exact: true }),
  );
  expect(await screen.findByLabelText("任务内容")).toHaveValue(
    "修复登录\n\n覆盖会话过期的情况",
  );
  expect(screen.getByLabelText("项目目录")).toHaveValue("/work/login");
  expect(screen.getByLabelText("任务名称（可选）")).toHaveValue("修复登录");
  expect(browserTodos().items[0].completedAt).toBeNull();
  await user.click(rail().getByRole("button", { name: "返回上一页" }));
  expect(
    await screen.findByRole("button", { name: "编辑计划：修复登录" }),
  ).toBeInTheDocument();
  expect(rail().getByRole("button", { name: "TODO List" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

it("moves checked plans to completed and restores them", async () => {
  add("整理文档");
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  await user.click(rail().getByRole("button", { name: "TODO List" }));
  await user.click(
    await screen.findByRole("checkbox", { name: "标记完成：整理文档" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "编辑计划：整理文档" }),
    ).not.toBeInTheDocument(),
  );
  await user.click(
    sidebar().getByRole("button", { name: "已完成", exact: true }),
  );
  expect(
    await screen.findByRole("checkbox", { name: "恢复未完成：整理文档" }),
  ).toBeChecked();
  expect(
    screen.queryByRole("button", { name: "创建任务", exact: true }),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("checkbox", { name: "恢复未完成：整理文档" }),
  );
  await waitFor(() => expect(browserTodos().items[0].completedAt).toBeNull());
  await user.click(
    sidebar().getByRole("button", { name: "未完成", exact: true }),
  );
  expect(
    await screen.findByRole("button", { name: "创建任务", exact: true }),
  ).toBeEnabled();
});

it("preserves plan edits across pages and asks before replacing a task draft", async () => {
  add("新增导出", { notes: "支持 Markdown" });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  await user.click(sidebar().getByRole("button", { name: /新建任务/ }));
  await user.type(screen.getByLabelText("任务内容"), "原来的内容");
  await user.click(rail().getByRole("button", { name: "TODO List" }));
  await user.click(
    await screen.findByRole("button", { name: "编辑计划：新增导出" }),
  );
  await user.type(screen.getByLabelText("备注"), "，保留格式");
  await user.click(rail().getByRole("button", { name: "设置偏好" }));
  await user.click(rail().getByRole("button", { name: "返回上一页" }));
  expect(screen.getByLabelText("备注")).toHaveValue("支持 Markdown，保留格式");
  await user.click(screen.getByRole("button", { name: "保存计划" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "创建任务", exact: true }),
    ).toBeEnabled(),
  );
  await user.click(
    screen.getByRole("button", { name: "创建任务", exact: true }),
  );
  expect(
    screen.getByRole("dialog", { name: "已有未提交的任务草稿" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "取消", exact: true }));
  await user.click(
    screen.getByRole("button", { name: "创建任务", exact: true }),
  );
  await user.click(screen.getByRole("button", { name: "追加到草稿" }));
  expect(await screen.findByLabelText("任务内容")).toHaveValue(
    "原来的内容\n\n新增导出\n\n支持 Markdown，保留格式",
  );
  expect(browserTodos().items[0].completedAt).toBeNull();
});

it("keeps unsaved edits on conflict and reloads only after confirmation", async () => {
  add("原计划");
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  await user.click(rail().getByRole("button", { name: "TODO List" }));
  await user.click(
    await screen.findByRole("button", { name: "编辑计划：原计划" }),
  );
  await user.type(screen.getByLabelText("备注"), "未保存的内容");
  const current = browserTodos();
  changeBrowserTodo("save_todo", {
    item: { ...current.items[0], notes: "来自其他窗口" },
    expected: current.revision,
  });
  await user.click(screen.getByRole("button", { name: "保存计划" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("计划已修改");
  expect(screen.getByLabelText("备注")).toHaveValue("未保存的内容");
  expect(browserTodos().items[0].notes).toBe("来自其他窗口");
  await user.click(screen.getByRole("button", { name: "刷新计划" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "保存计划" })).toBeDisabled(),
  );
  await user.click(
    screen.getByRole("button", { name: "重新载入", exact: true }),
  );
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "取消" }),
  );
  expect(screen.getByLabelText("备注")).toHaveValue("未保存的内容");
  await user.click(
    screen.getByRole("button", { name: "重新载入", exact: true }),
  );
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "重新载入",
      exact: true,
    }),
  );
  expect(screen.getByLabelText("备注")).toHaveValue("来自其他窗口");
  expect(screen.getByRole("button", { name: "保存计划" })).toBeEnabled();
});
