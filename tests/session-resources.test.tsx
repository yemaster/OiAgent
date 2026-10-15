import { expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DetailPage } from "@/pages/Detail";
import { SessionCommands } from "@/components/workspace/SessionActivity";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
import type { SessionCommand } from "@/lib/sessionActivity";
vi.mock("@/lib/api", () => ({ call: vi.fn(), desktop: true }));

it("opens services directly from the conversation and follows the source command", async () => {
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
    name: "服务 1，1 条未读",
  });
  const commandEntry = screen.getByRole("button", { name: "命令 1，1 条未读" });
  await user.click(serviceEntry);
  const panel = screen.getByRole("region", { name: "会话服务" });
  expect(within(panel).getByText("localhost", { exact: true })).toBeVisible();
  expect(within(panel).getByText("5173", { exact: true })).toBeVisible();
  expect(serviceEntry).toHaveAttribute("aria-label", "服务 1");
  expect(commandEntry).toHaveAttribute("aria-label", "命令 1，1 条未读");
  await user.click(within(panel).getByRole("button", { name: "检测端口" }));
  expect(await within(panel).findByText("可连接")).toBeVisible();
  expect(call).toHaveBeenCalledWith("probe_service_ports", { ports: [5173] });
  await user.click(within(panel).getByRole("button", { name: "查看命令" }));
  expect(screen.getByRole("tab", { name: "命令" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("button", { name: "复制完整命令" })).toBeVisible();
  expect(commandEntry).toHaveAttribute("aria-label", "命令 1");
});

it("reveals a service source command even beyond the first page of command history", () => {
  const commands: SessionCommand[] = Array.from({ length: 60 }, (_, index) => ({
    id: String(index),
    command: `echo ${index}`,
    timestamp: "",
    output: "done",
    summary: "done",
    state: "completed",
    background: false,
    language: "bash",
  }));
  render(
    <TooltipProvider>
      <SessionCommands commands={commands} selected="0" />
    </TooltipProvider>,
  );
  expect(screen.getByRole("button", { name: "复制完整命令" })).toBeVisible();
  expect(screen.getAllByText("echo 0").length).toBeGreaterThan(0);
});
