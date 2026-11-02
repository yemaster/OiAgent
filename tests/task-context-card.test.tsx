import { render, screen, within, fireEvent } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { TaskContextCard } from "@/components/workspace/TaskContextCard";
import { TooltipProvider } from "@/components/ui/tooltip";
import { demoSnapshot } from "@/lib/demo";
import { buildTranscript } from "@/lib/transcript";
import { call } from "@/lib/api";
import type { SessionCommand } from "@/lib/sessionActivity";
vi.mock("@/lib/api", () => ({ desktop: true, call: vi.fn() }));

it("previews real Git files, plan steps, commands and ports before their detail links", async () => {
  vi.mocked(call).mockResolvedValue({
    git: true,
    files: Array.from({ length: 6 }, (_, i) => ({
      path: `file-${i}.ts`,
      status: i === 0 ? "??" : " M",
    })),
    truncated: false,
  });
  const onGit = vi.fn(),
    onPlan = vi.fn(),
    onOpen = vi.fn(),
    onPorts = vi.fn(),
    onFile = vi.fn();
  const processes: SessionCommand[] = Array.from({ length: 5 }, (_, i) => ({
    id: String(i),
    command: `node server-${i}.js`,
    state: i === 4 ? "pending" : "running",
    background: i !== 4,
    timestamp: "",
    output: "",
    summary: "",
    language: "bash",
  }));
  const services = Array.from({ length: 5 }, (_, i) => ({
    id: String(i),
    commandId: String(i),
    command: "node server.js",
    host: "localhost",
    port: 8000 + i,
    local: true,
    reachable: true,
  }));
  render(
    <TooltipProvider>
      <TaskContextCard
        task={demoSnapshot.tasks[0]}
        timeline={buildTranscript([
          {
            role: "tool",
            text: "",
            timestamp: "",
            tool: {
              name: "update_plan",
              callId: "plan",
              input: {
                plan: Array.from({ length: 6 }, (_, i) => ({
                  step: `步骤 ${i}`,
                  status: i === 0 ? "completed" : "pending",
                })),
              },
              output: {},
              state: "completed",
            },
          },
        ])}
        changes={[]}
        processes={processes}
        services={services}
        unread={{ changes: 0, processes: 0, artifacts: 0 }}
        onClose={vi.fn()}
        onChange={vi.fn()}
        onOpen={onOpen}
        onGit={onGit}
        onFile={onFile}
        onPorts={onPorts}
        onPlan={onPlan}
      />
    </TooltipProvider>,
  );
  const git = await screen.findByRole("region", { name: "Git 改动" });
  expect(await within(git).findByText("file-0.ts")).toBeVisible();
  expect(within(git).getAllByRole("listitem")).toHaveLength(4);
  expect(within(git).queryByText("file-4.ts")).not.toBeInTheDocument();
  fireEvent.click(
    within(git).getByRole("button", { name: "查看 Git 改动：file-0.ts" }),
  );
  expect(onFile).toHaveBeenCalledWith(
    demoSnapshot.tasks[0].project,
    "file-0.ts",
    "diff",
    undefined,
  );
  fireEvent.click(within(git).getByRole("button", { name: "查看 Git 详情" }));
  expect(onGit).toHaveBeenCalledOnce();
  const plan = screen.getByRole("region", { name: "执行计划" });
  expect(within(plan).getAllByRole("listitem")).toHaveLength(4);
  fireEvent.click(within(plan).getByRole("button", { name: "查看完整计划" }));
  expect(onPlan).toHaveBeenCalledOnce();
  const running = screen.getByRole("region", { name: "运行摘要" });
  expect(within(running).getAllByRole("listitem")).toHaveLength(3);
  expect(within(running).getByText("node server-4.js")).toBeVisible();
  expect(within(running).getByText("等待结果")).toBeVisible();
  fireEvent.click(
    within(running).getByRole("button", { name: "查看进程详情" }),
  );
  expect(onOpen).toHaveBeenCalledWith("processes");
  const ports = screen.getByRole("region", { name: "端口摘要" });
  expect(within(ports).getAllByRole("listitem")).toHaveLength(3);
  expect(within(ports).getByText("localhost:8000")).toBeVisible();
  fireEvent.click(within(ports).getByRole("button", { name: "查看端口详情" }));
  expect(onPorts).toHaveBeenCalledOnce();
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
});

it("shows the latest edit's combined fragment counts and keeps opening the file's detail", () => {
  const onChange = vi.fn();
  const base = {
    path: "/repo/main.ts",
    relativePath: "main.ts",
    operation: "edit" as const,
    state: "completed" as const,
    scope: "fragment" as const,
    timestamp: "",
  };
  render(
    <TooltipProvider>
      <TaskContextCard
        task={demoSnapshot.tasks[0]}
        timeline={[]}
        processes={[]}
        services={[]}
        changes={[
          { ...base, id: "old", step: "old", before: "old", after: "old edit" },
          { ...base, id: "one", step: "latest", before: "one", after: "two" },
          {
            ...base,
            id: "two",
            step: "latest",
            before: "",
            after: "three\nfour\n",
          },
        ]}
        unread={{ changes: 0, processes: 0, artifacts: 0 }}
        onClose={vi.fn()}
        onChange={onChange}
        onOpen={vi.fn()}
        onPlan={vi.fn()}
      />
    </TooltipProvider>,
  );
  const row = within(
    screen.getByRole("region", { name: "会话改动摘要" }),
  ).getByRole("button", { name: /main.ts/ });
  expect(within(row).getByText("+3")).toBeVisible();
  expect(within(row).getByText("-1")).toBeVisible();
  expect(within(row).queryByText("修改")).not.toBeInTheDocument();
  fireEvent.click(row);
  expect(onChange).toHaveBeenCalledWith("/repo/main.ts");
});
