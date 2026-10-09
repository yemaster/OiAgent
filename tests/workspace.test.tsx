import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "@/App";
import { filterTasks, csv, groupBy, usageRecords } from "@/lib/types";
import { demoSnapshot } from "@/lib/demo";
beforeEach(() => localStorage.setItem("oiagent-onboarded", "true"));
describe("workspace navigation", () => {
  it("closes to the most recently visited tab and finally returns to the originating page", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "当前任务" });
    await user.click(
      within(screen.getByRole("complementary", { name: "侧边导航" })).getByRole(
        "button",
        { name: "历史记录", exact: true },
      ),
    );
    await screen.findByRole("heading", { name: "历史记录" });
    const tasks = demoSnapshot.tasks.slice(0, 3);
    for (const task of tasks) {
      await user.keyboard("{Control>}k{/Control}");
      const dialog = await screen.findByRole("dialog", { name: /搜索工作区/ });
      await user.clear(within(dialog).getByRole("textbox"));
      await user.type(within(dialog).getByRole("textbox"), task.title);
      await user.click(
        within(dialog).getByRole("button", { name: new RegExp(task.title) }),
      );
      await screen.findByRole("heading", { name: task.title });
    }
    const tabs = within(
      screen.getByRole("tablist", { name: "打开的任务与文件" }),
    );
    await user.click(
      tabs.getByRole("tab", { name: new RegExp(tasks[0].title) }),
    );
    await user.click(
      tabs.getByRole("button", { name: `关闭标签：${tasks[0].title}` }),
    );
    expect(
      tabs.getByRole("tab", { name: new RegExp(tasks[2].title) }),
    ).toHaveAttribute("aria-selected", "true");
    await user.click(
      tabs.getByRole("button", { name: `关闭标签：${tasks[1].title}` }),
    );
    expect(
      tabs.getByRole("tab", { name: new RegExp(tasks[2].title) }),
    ).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Control>}w{/Control}");
    await screen.findByRole("heading", { name: "历史记录" });
    expect(
      screen.getByRole("tab", { name: "当前页面：历史记录" }),
    ).toHaveAttribute("aria-selected", "true");
  });
  it("opens current tasks after the first launch even if the guide was not completed", async () => {
    localStorage.removeItem("oiagent-onboarded");
    const view = render(<App />);
    await screen.findByRole("heading", { name: "欢迎使用 OiAgent" });
    view.unmount();
    render(<App />);
    await screen.findByRole("heading", { name: "当前任务" });
    expect(
      screen.queryByRole("heading", { name: "欢迎使用 OiAgent" }),
    ).not.toBeInTheDocument();
  });
  it("shows task status, searches and opens a chat detail", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "当前任务" }),
    ).toBeInTheDocument();
    expect(screen.getByText("演示数据 · 不连接本机")).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "搜索任务" }),
      "API 错误",
    );
    expect(
      screen.queryByRole("heading", { name: "补充组件的键盘交互测试" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: /^打开会话：检查 API 错误处理与重试逻辑/,
      }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "检查 API 错误处理与重试逻辑",
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("等待操作，追加消息暂不执行"),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "继续对话" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "查看原因" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "返回任务列表" }));
    expect(
      await screen.findByRole("heading", { name: "当前任务" }),
    ).toBeInTheDocument();
  });
  it("filters history by project and restores archived records", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "当前任务" });
    await user.click(
      within(screen.getByRole("complementary", { name: "侧边导航" })).getByRole(
        "button",
        { name: "历史记录", exact: true },
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "历史记录" }),
    ).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "搜索任务" }),
      "讨论工作区",
    );
    await user.click(
      screen.getByRole("button", { name: /^打开会话：讨论工作区的信息架构/ }),
    );
    await screen.findByRole("textbox", { name: "继续对话" });
    await user.click(screen.getByRole("button", { name: "任务信息" }));
    await user.click(screen.getByRole("button", { name: "归档记录" }));
    await screen.findByRole("heading", { name: "历史记录" });
    await user.click(
      within(screen.getByRole("complementary", { name: "侧边导航" })).getByRole(
        "button",
        { name: "已归档", exact: true },
      ),
    );
    await screen.findByRole("heading", { name: "已归档" });
    expect(
      await screen.findByRole("button", {
        name: /^打开会话：讨论工作区的信息架构/,
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^恢复会话：/ }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", {
          name: /^打开会话：讨论工作区的信息架构/,
        }),
      ).not.toBeInTheDocument(),
    );
  });
  it("opens all launch modes and configuration pages", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "当前任务" });
    const nav = within(screen.getByRole("navigation", { name: "工具栏" }));
    await user.click(
      within(screen.getByRole("complementary", { name: "侧边导航" })).getByRole(
        "button",
        { name: /新建任务/ },
      ),
    );
    await user.click(screen.getByRole("button", { name: "运行方式" }));
    await user.click(screen.getByRole("menuitemradio", { name: /自定义命令/ }));
    expect(
      screen.getByRole("textbox", { name: "启动命令" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "运行方式" }));
    await user.click(screen.getByRole("menuitemradio", { name: /交互终端/ }));
    expect(screen.getByRole("button", { name: "打开终端" })).toBeDisabled();
    await user.click(nav.getByRole("button", { name: "自动化", exact: true }));
    await user.click(screen.getByRole("button", { name: "新建工作流" }));
    expect(
      await screen.findByRole("textbox", { name: "任务目标" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "LLM API 设置" }));
    expect(screen.getByLabelText("API Key")).toHaveAttribute(
      "type",
      "password",
    );
    await user.click(nav.getByRole("button", { name: "插件", exact: true }));
    await user.click(screen.getByRole("button", { name: "导入插件" }));
    expect(
      (
        screen.getByRole("textbox", {
          name: "插件 JSON",
        }) as HTMLTextAreaElement
      ).value,
    ).toContain("schemaVersion");
  });
  it("offers actionable onboarding once and allows reopening the guide", async () => {
    localStorage.removeItem("oiagent-onboarded");
    const user = userEvent.setup();
    const view = render(<App />);
    await screen.findByRole("heading", { name: "欢迎使用 OiAgent" });
    await user.click(screen.getByRole("button", { name: "查看历史记录" }));
    await screen.findByRole("heading", { name: "历史记录" });
    await user.click(
      within(screen.getByRole("navigation", { name: "工具栏" })).getByRole(
        "button",
        { name: "使用指南" },
      ),
    );
    await screen.findByRole("heading", { name: "欢迎使用 OiAgent" });
    await user.click(screen.getByRole("button", { name: "查看当前任务" }));
    expect(localStorage.getItem("oiagent-onboarded")).toBe("true");
    view.unmount();
    render(<App />);
    await screen.findByRole("heading", { name: "当前任务" });
    expect(
      screen.queryByRole("heading", { name: "欢迎使用 OiAgent" }),
    ).not.toBeInTheDocument();
  });
  it("prioritizes waiting tasks and separates current work from history", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "当前任务" });
    const activeCards = screen.getAllByRole("heading", { level: 3 });
    expect(activeCards[0]).toHaveTextContent("检查 API 错误处理与重试逻辑");
    await user.click(screen.getByRole("tab", { name: /等待操作/ }));
    expect(screen.queryByText("最近记录")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "补充组件的键盘交互测试" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /^打开会话：检查 API 错误处理与重试逻辑/,
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /全部/ }));
    await user.click(screen.getByRole("button", { name: "全部历史" }));
    await screen.findByRole("heading", { name: "历史记录" });
  });
});
describe("task data", () => {
  it("combines project, agent and text filters", () => {
    expect(
      filterTasks(
        demoSnapshot.tasks,
        "项目目录",
        demoSnapshot.projects[0],
        "qwen",
      ),
    ).toHaveLength(0);
    expect(
      filterTasks(
        demoSnapshot.tasks,
        "筛选",
        demoSnapshot.projects[0],
        "claude",
      )[0].title,
    ).toBe("实现项目目录筛选");
  });
  it("escapes CSV and avoids spreadsheet formula injection", () => {
    const t = { ...demoSnapshot.tasks[0], title: '=HYPERLINK("x")' };
    expect(csv([t])).toContain('"\'=HYPERLINK(""x"")"');
  });
  it("counts a resumed native session only once", () => {
    const base = demoSnapshot.tasks[0];
    const sessionUsage = { input: 1000, output: 100, cached: 300, known: true };
    const rows = usageRecords([
      { ...base, id: "run1", sessionId: "shared", sessionUsage },
      { ...base, id: "run2", sessionId: "shared", sessionUsage },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].usage.input).toBe(1000);
  });
  it("preserves all tasks when grouping", () => {
    const groups = groupBy(demoSnapshot.tasks, (t) => t.project);
    expect([...groups.values()].flat()).toHaveLength(demoSnapshot.tasks.length);
  });
});

it("keeps the current page pinned and restores it without closing an open task", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  const pinned = screen.getByRole("tab", { name: "当前页面：当前任务" });
  expect(pinned).toHaveAttribute("aria-selected", "true");
  const task = demoSnapshot.tasks[0];
  await user.keyboard("{Control>}k{/Control}");
  const dialog = await screen.findByRole("dialog", { name: /搜索工作区/ });
  await user.type(within(dialog).getByRole("textbox"), task.title);
  await user.click(
    within(dialog).getByRole("button", { name: new RegExp(task.title) }),
  );
  await screen.findByRole("heading", { name: task.title });
  expect(pinned).toHaveAttribute("aria-selected", "false");
  await user.click(pinned);
  await screen.findByRole("heading", { name: "当前任务" });
  expect(
    screen.getByRole("tab", { name: new RegExp(task.title) }),
  ).toBeVisible();
  await user.keyboard("{Delete}");
  expect(pinned).toBeVisible();
  await user.click(screen.getByRole("tab", { name: new RegExp(task.title) }));
  await user.keyboard("{Home}");
  expect(pinned).toHaveAttribute("aria-selected", "true");
  await waitFor(() => expect(pinned).toHaveFocus());
  await user.keyboard("{ArrowRight}");
  expect(
    screen.getByRole("tab", { name: new RegExp(task.title) }),
  ).toHaveAttribute("aria-selected", "true");
});
