import { expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DetailPage } from "@/pages/Detail";
import { SessionProcesses } from "@/components/workspace/SessionActivity";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
import type { SessionCommand } from "@/lib/sessionActivity";
vi.mock("@/lib/api", () => ({ call: vi.fn(), desktop: true }));

it("opens a shared processes and services tab without listing completed commands", async () => {
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
  const serviceEntry = await screen.findByRole("button", {
    name: "进程和服务 1，1 条未读",
  });
  await user.click(serviceEntry);
  const panel = screen.getByRole("region", { name: "会话服务" });
  expect(within(panel).getByText("localhost", { exact: true })).toBeVisible();
  expect(within(panel).getByText("5173", { exact: true })).toBeVisible();
  expect(serviceEntry).toHaveAttribute("aria-label", "进程和服务 1");
  await user.click(within(panel).getByRole("button", { name: "检测端口" }));
  expect(await within(panel).findByText("可连接")).toBeVisible();
  expect(call).toHaveBeenCalledWith("probe_service_ports", { ports: [5173] });
  expect(
    screen.queryByRole("tab", { name: "命令", exact: true }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("tab", { name: "服务", exact: true }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "进程和服务" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByText("暂无运行中的进程")).toBeVisible();
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
