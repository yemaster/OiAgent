import { expect, it, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DetailPage } from "@/pages/Detail";
import { SessionProcesses } from "@/components/workspace/SessionActivity";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
import type { SessionCommand } from "@/lib/sessionActivity";
vi.mock("@/lib/api", () => ({ call: vi.fn(), desktop: true }));

it("opens process details from a compact card without workspace tabs", async () => {
  const task = {
    ...demoSnapshot.tasks[0],
    id: "resources-task",
    source: "managed",
    status: "completed",
  };
  vi.mocked(call).mockImplementation(async (name) => {
    if (name === "get_detail")
      return {
        task,
        log: "",
        messages: [
          {
            role: "tool",
            text: "",
            timestamp: "",
            tool: {
              callId: "start",
              name: "Bash",
              state: "completed",
              input: { command: "npm run dev" },
              output: {
                output: "Local: http://localhost:5173/",
                session_id: 1,
              },
            },
          },
        ],
      };
    if (name === "task_artifacts") return { files: [], truncated: false };
    if (name === "probe_service_ports")
      return [{ port: 5173, reachable: true }];
    return [];
  });
  render(
    <TooltipProvider>
      <DetailPage
        task={task}
        tasks={[]}
        agents={demoSnapshot.agents}
        profiles={[]}
        onBack={vi.fn()}
        onRetry={vi.fn()}
        onOpen={vi.fn()}
        onChanged={vi.fn()}
      />
    </TooltipProvider>,
  );
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "任务进展", exact: true }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("complementary", { name: "任务进展" }),
    ).toBeVisible(),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const serviceEntry = await screen.findByRole("button", {
    name: /^端口 1/,
  });
  const card = screen.getByRole("complementary", { name: "任务进展" });
  expect(within(card).queryByRole("tablist")).not.toBeInTheDocument();
  expect(
    within(card).queryByRole("button", { name: "放大工作区" }),
  ).not.toBeInTheDocument();
  await user.click(serviceEntry);
  expect(screen.getByRole("dialog")).toBeVisible();
  const panel = screen.getByRole("region", { name: "会话服务" });
  expect(
    within(panel).getByText("localhost:5173", { exact: true }),
  ).toBeVisible();

  expect(await within(panel).findByText("可连接")).toBeVisible();
  expect(call).toHaveBeenCalledWith("probe_service_ports", { ports: [5173] });
  expect(
    screen.queryByRole("tab", { name: "命令", exact: true }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("tab", { name: "服务", exact: true }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("暂无运行中的进程")).toBeVisible();
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(
      screen.getByRole("complementary", { name: "任务进展" }),
    ).toBeVisible(),
  );
  expect(
    screen.getByRole("button", { name: /^端口 1/, exact: true }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "关闭任务进展" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("complementary", { name: "任务进展" }),
    ).not.toBeInTheDocument(),
  );
});

it("shows only running processes and removes them when they finish", async () => {
  const commands: SessionCommand[] = [
    "completed",
    "failed",
    "unknown",
    "running",
  ].map((state, index) => ({
    id: String(index),
    command: `process-${state}`,
    timestamp: "",
    output: "output",
    summary: "output",
    state: state as SessionCommand["state"],
    background: false,
    language: "bash",
  }));
  const { rerender } = render(
    <TooltipProvider>
      <SessionProcesses commands={commands} />
    </TooltipProvider>,
  );
  expect(screen.getByText("process-running")).toBeVisible();
  for (const state of ["completed", "failed", "unknown"])
    expect(screen.queryByText(`process-${state}`)).not.toBeInTheDocument();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { expanded: false }));
  expect(screen.getByRole("button", { name: "复制完整命令" })).toBeVisible();
  rerender(
    <TooltipProvider>
      <SessionProcesses
        commands={commands.map((command) => ({
          ...command,
          state: "completed",
        }))}
      />
    </TooltipProvider>,
  );
  expect(screen.queryByText("process-running")).not.toBeInTheDocument();
  expect(screen.getByText("暂无运行中的进程")).toBeVisible();
});

it("announces a silent PORT-configured service before the details panel is opened", async () => {
  const task = {
    ...demoSnapshot.tasks[0],
    id: "silent-server-task",
    source: "managed",
    status: "running",
  };
  vi.mocked(call).mockClear();
  vi.mocked(call).mockImplementation(async (name) => {
    if (name === "get_detail")
      return {
        task,
        log: "",
        messages: [
          {
            role: "tool",
            text: "",
            timestamp: "",
            tool: {
              callId: "server-start",
              name: "Bash",
              state: "completed",
              input: { command: "cd /project && PORT=8080 node server.js" },
              output: { session_id: "server", output: "" },
            },
          },
        ],
      };
    if (name === "task_artifacts") return { files: [], truncated: false };
    if (name === "probe_service_ports")
      return [{ port: 8080, reachable: true }];
    return [];
  });
  render(
    <TooltipProvider>
      <DetailPage
        task={task}
        tasks={[]}
        agents={demoSnapshot.agents}
        profiles={[]}
        onBack={vi.fn()}
        onRetry={vi.fn()}
        onOpen={vi.fn()}
        onChanged={vi.fn()}
      />
    </TooltipProvider>,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "任务进展", exact: true }));
  const entry = await screen.findByRole("button", {
    name: "进程 1，2 条未读",
  });
  await userEvent.setup().click(entry);
  expect(screen.getByRole("dialog")).toBeVisible();
  const panel = screen.getByRole("region", { name: "会话服务" });
  expect(
    within(panel).getByText("localhost:8080", { exact: true }),
  ).toBeVisible();
  expect(within(panel).getByText("可连接")).toBeVisible();
  await userEvent
    .setup()
    .click(within(panel).getByRole("button", { name: "访问" }));
  expect(call).toHaveBeenCalledWith("open_conversation_link", {
    url: "http://localhost:8080/",
  });
});

it("opens the full plan from the sidebar heading without a tab or search", async () => {
  const task = {
    ...demoSnapshot.tasks[0],
    id: "plan-link-task",
    status: "completed",
    source: "managed",
  };
  const plan = Array.from({ length: 6 }, (_, i) => ({
    step: `检查项目 ${i + 1}`,
    status: "pending",
  }));
  vi.mocked(call).mockImplementation(async (name) => {
    if (name === "get_detail")
      return {
        task,
        log: "",
        messages: [
          {
            role: "tool",
            text: "",
            timestamp: "",
            tool: {
              callId: "plan",
              name: "update_plan",
              state: "completed",
              input: { plan },
              output: {},
            },
          },
        ],
      };
    if (name === "task_artifacts") return { files: [], truncated: false };
    return [];
  });
  render(
    <TooltipProvider>
      <DetailPage
        task={task}
        tasks={[]}
        agents={demoSnapshot.agents}
        profiles={[]}
        onBack={vi.fn()}
        onRetry={vi.fn()}
        onOpen={vi.fn()}
        onChanged={vi.fn()}
      />
    </TooltipProvider>,
  );
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "任务进展", exact: true }),
  );
  const card = screen.getByRole("complementary", { name: "任务进展" });
  await user.click(
    await within(card).findByRole("button", { name: /计划.*0\/6/ }),
  );
  expect(await screen.findByText("检查项目 6")).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
});
