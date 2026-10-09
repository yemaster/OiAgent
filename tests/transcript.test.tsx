import { describe, it, expect, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildTranscript, describeTool } from "@/lib/transcript";
import { Transcript } from "@/components/workspace/Transcript";
import { demoSnapshot } from "@/lib/demo";
import {
  usageRecords,
  projectName,
  type Message,
  type ToolEvent,
} from "@/lib/types";
import App from "@/App";
const event = (
  callId: string,
  name: string,
  input: unknown,
  output: unknown = null,
  state: ToolEvent["state"] = "called",
): Message => ({
  role: "tool",
  text: name,
  timestamp: "now",
  tool: { callId, name, input, output, state },
});
describe("tool transcripts", () => {
  it("expands execution groups while keeping leaf tools and delegations collapsed", () => {
    const rows = buildTranscript([
      event("shell", "Bash", { command: "pwd" }, "done", "completed"),
      event("read", "Read", { file_path: "a.ts" }, "content", "completed"),
      event("plan", "TodoWrite", { todos: [] }, null, "completed"),
      event("agent", "Agent", { description: "review" }, null, "completed"),
    ]);
    const view = render(
      <Transcript
        items={rows}
        task={demoSnapshot.tasks[4]}
        childTasks={[]}
        onOpen={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /执行过程 · 4 步/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("派发子 Agent")).toBeVisible();
    const leaves = view.container.querySelectorAll("details.group\\/step");
    expect(leaves).toHaveLength(4);
    leaves.forEach((leaf) => expect(leaf).not.toHaveAttribute("open"));
  });

  it("pairs parallel results by call ID, preserving input and order", () => {
    const rows = buildTranscript([
      event("a", "Bash", { command: "ls" }),
      event("b", "Read", { file_path: "src/a.ts" }),
      event("b", "", null, "file content", "completed"),
      event("a", "", null, { exit_code: 1, output: "failed" }, "completed"),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      kind: "tool",
      tool: {
        callId: "a",
        name: "Bash",
        input: { command: "ls" },
        output: { exit_code: 1 },
      },
    });
    expect(rows[1]).toMatchObject({
      kind: "tool",
      tool: { callId: "b", output: "file content" },
    });
  });
  it("shows a readable command and output, with JSON only in the raw-event disclosure", async () => {
    const user = userEvent.setup();
    const rows = buildTranscript([
      event(
        "a",
        "exec_command",
        { cmd: "npm test", workdir: "/project" },
        [
          {
            type: "input_text",
            text: '{"chunk_id":"hidden-metadata","exit_code":1,"output":"Test failed: expected true"}',
          },
        ],
        "completed",
      ),
    ]);
    render(
      <Transcript
        items={rows}
        task={demoSnapshot.tasks[4]}
        childTasks={[]}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText("执行命令")).toBeVisible();
    expect(screen.getByText("执行失败")).toBeVisible();
    expect(screen.getByText("Test failed: expected true")).not.toBeVisible();
    await user.click(screen.getByText("执行命令"));
    expect(screen.getByText("Test failed: expected true")).toBeVisible();
    expect(screen.getByText("退出码 1")).toBeVisible();
    const raw = screen.getByText("原始事件").parentElement!;
    expect(raw).not.toHaveAttribute("open");
    await user.click(screen.getByText("原始事件"));
    expect(raw).toHaveAttribute("open");
    expect(within(raw).getByText(/hidden-metadata/)).toBeVisible();
  });
  it("nests child stream events under their delegation instead of the parent answer", () => {
    const childMessage: Message = {
      role: "assistant",
      text: "Child-only report",
      timestamp: "now",
      parentCallId: "delegate",
    };
    const rows = buildTranscript([
      event("delegate", "Agent", { description: "check" }),
      childMessage,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "tool",
      nested: [{ kind: "message", message: { text: "Child-only report" } }],
    });
  });
  it("joins text deltas but keeps tool boundaries intact", () => {
    const rows = buildTranscript([
      { role: "assistant", text: "Hel", timestamp: "", delta: true },
      { role: "assistant", text: "lo", timestamp: "", delta: true },
      event("r", "Read", {}),
      { role: "assistant", text: "done", timestamp: "", delta: true },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ message: { text: "Hello" } });
    expect(
      describeTool({
        ...event("r", "Edit", {
          file_path: "a.ts",
          old_string: "a",
          new_string: "b",
        }).tool!,
      }),
    ).toMatchObject({ kind: "edit", title: "修改文件", detail: "a.ts" });
  });
  it("keeps child usage separate even when Claude shares the parent session ID", () => {
    const parent = demoSnapshot.tasks[0];
    const child = {
      ...parent,
      id: "child",
      parentId: parent.id,
      subagentId: "child-agent",
    };
    expect(usageRecords([parent, child])).toHaveLength(2);
  });
});
describe("workspace navigation changes", () => {
  it("places Agent, plugins and preferences directly on the rail with right-side tooltips", async () => {
    localStorage.setItem("oiagent-onboarded", "true");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "当前任务" });
    const nav = within(screen.getByRole("navigation", { name: "工具栏" }));
    const agents = nav.getByRole("button", { name: "Agent 程序" });
    await user.hover(agents);
    await screen.findByRole("tooltip");
    expect(
      document.querySelector('[data-slot="tooltip-content"]'),
    ).toHaveAttribute("data-side", "right");
    await user.unhover(agents);
    await user.click(agents);
    await screen.findByRole("heading", { name: "Agent 程序" });
    expect(
      screen.getByRole("heading", { name: "Gemini CLI" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "OpenCode" }),
    ).toBeInTheDocument();
    await user.click(nav.getByRole("button", { name: "设置偏好" }));
    await screen.findByRole("heading", { name: "通用设置" });
    const sidebar = within(
      screen.getByRole("complementary", { name: "侧边导航" }),
    );
    expect(
      sidebar.queryByRole("button", { name: "插件" }),
    ).not.toBeInTheDocument();
    await user.click(nav.getByRole("button", { name: "插件" }));
    await screen.findByRole("heading", { name: "插件" });
  });
  it("uses the selected tab's task and project in breadcrumbs after visiting settings", async () => {
    localStorage.setItem("oiagent-onboarded", "true");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "当前任务" });
    const task = demoSnapshot.tasks[0];
    await user.click(
      screen.getByRole("button", { name: new RegExp(task.title) }),
    );
    await screen.findByRole("heading", { name: task.title });
    await user.type(
      screen.getByRole("textbox", { name: "继续对话" }),
      "保留这段草稿",
    );
    await user.click(
      within(screen.getByRole("navigation", { name: "工具栏" })).getByRole(
        "button",
        { name: "设置偏好" },
      ),
    );
    await screen.findByRole("heading", { name: "通用设置" });
    await user.click(screen.getByRole("tab", { name: new RegExp(task.title) }));
    const breadcrumb = screen.getByRole("navigation", { name: "面包屑" });
    expect(breadcrumb).toHaveTextContent("工作台");
    expect(breadcrumb).toHaveTextContent(projectName(task.project));
    expect(breadcrumb).toHaveTextContent(task.title);
    expect(breadcrumb).not.toHaveTextContent("设置偏好");
    expect(screen.getByRole("textbox", { name: "继续对话" })).toHaveValue(
      "保留这段草稿",
    );
  });
  it("opens a dedicated Claude API page from the program card and returns to the task draft", async () => {
    localStorage.setItem("oiagent-onboarded", "true");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "当前任务" });
    await user.click(
      within(screen.getByRole("complementary", { name: "侧边导航" })).getByRole(
        "button",
        { name: /新建任务/ },
      ),
    );
    await user.type(
      screen.getByRole("textbox", { name: "任务内容" }),
      "保存我的任务草稿",
    );
    await user.click(screen.getByRole("button", { name: /管理程序/ }));
    expect(
      screen.queryByRole("button", { name: "添加 API" }),
    ).not.toBeInTheDocument();
    const card = screen
      .getByRole("heading", { name: "Claude Code", exact: true })
      .closest('[data-slot="card"]')!;
    await user.click(
      within(card as HTMLElement).getByRole("button", {
        name: "Claude Code API 配置",
      }),
    );
    await screen.findByRole("heading", { name: "Claude Code API 配置" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "添加 API" })).toBeVisible(),
    );
    await user.click(screen.getByRole("button", { name: "返回 Agent 程序" }));
    await user.click(screen.getByRole("button", { name: "返回新建任务" }));
    expect(screen.getByRole("textbox", { name: "任务内容" })).toHaveValue(
      "保存我的任务草稿",
    );
  });
  it("opens a child conversation and returns to its parent", async () => {
    localStorage.setItem("oiagent-onboarded", "true");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "当前任务" });
    await user.click(
      screen.getByRole("button", { name: /完善任务详情的对话体验/ }),
    );
    await screen.findByRole("button", { name: "子 Agent 1" });
    expect(
      screen.queryByRole("tab", { name: "原始日志" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "子 Agent 1" }));
    await user.click(screen.getByRole("button", { name: /代码检查/ }));
    await screen.findByRole("heading", { name: "检查消息列表的滚动行为" });
    expect(
      screen.queryByRole("textbox", { name: "继续对话" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /返回父会话/ }));
    await screen.findByRole("heading", { name: "完善任务详情的对话体验" });
  });
});
