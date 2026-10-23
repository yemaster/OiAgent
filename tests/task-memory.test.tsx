import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DetailPage } from "@/pages/Detail";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
import { RESOURCE_IDLE_MS } from "@/hooks/useIdleResource";

vi.mock("@/lib/api", () => ({
  call: vi.fn(),
  desktop: true,
  exportText: vi.fn(),
}));
vi.mock("@/components/workspace/TerminalView", () => ({
  TerminalView: () => <div aria-label="交互终端" />,
}));
afterEach(() => vi.useRealTimers());
const task = {
  ...demoSnapshot.tasks[0],
  id: "memory",
  status: "completed",
  source: "managed",
  agentKind: "claude",
  agentId: "claude",
};
const agents = [
  { ...demoSnapshot.agents[0], kind: "claude", id: "claude", available: true },
];
function setup() {
  vi.useFakeTimers();
  vi.mocked(call).mockReset();
  vi.mocked(call).mockImplementation(async (command) => {
    if (command === "task_artifacts") return { files: [], truncated: false };
    if (command === "task_approvals") return [];
    return {
      task,
      revision: "r1",
      contentVersion: "v1",
      log: "log",
      messages: [{ role: "user", text: "持久化的历史消息", timestamp: "t" }],
    };
  });
}
function Page({ active = true }: { active?: boolean }) {
  return (
    <TooltipProvider>
      <DetailPage
        task={task}
        tasks={[task]}
        agents={agents}
        profiles={[]}
        active={active}
        onBack={vi.fn()}
        onOpen={vi.fn()}
        onChanged={async () => {}}
        onRetry={vi.fn()}
      />
    </TooltipProvider>
  );
}
it("releases inactive transcript views, preserves the draft and reloads the complete detail on return", async () => {
  setup();
  const page = render(<Page />);
  await act(async () => {});
  expect(screen.getByText("持久化的历史消息")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "继续对话" }), {
    target: { value: "还没发送\n第二行" },
  });
  page.rerender(<Page active={false} />);
  const reads = vi
    .mocked(call)
    .mock.calls.filter(([cmd]) => cmd === "get_detail").length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RESOURCE_IDLE_MS - 1);
  });
  expect(screen.getByText("持久化的历史消息")).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(screen.queryByLabelText("对话消息")).not.toBeInTheDocument();
  expect(
    vi.mocked(call).mock.calls.filter(([cmd]) => cmd === "get_detail"),
  ).toHaveLength(reads);
  page.rerender(<Page />);
  await act(async () => {});
  expect(screen.getByText("持久化的历史消息")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "继续对话" })).toHaveValue(
    "还没发送\n第二行",
  );
  expect(
    vi
      .mocked(call)
      .mock.calls.filter(([cmd]) => cmd === "get_detail")
      .at(-1),
  ).toEqual(["get_detail", { id: task.id }]);
});
it("keeps visible panes resident and cancels eviction on a quick tab switch", async () => {
  setup();
  const page = render(<Page />);
  await act(async () => {});
  page.rerender(<Page active={false} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RESOURCE_IDLE_MS - 1);
  });
  page.rerender(<Page />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RESOURCE_IDLE_MS + 1);
  });
  expect(screen.getByText("持久化的历史消息")).toBeInTheDocument();
});

it("protects an in-progress historical message edit from background eviction", async () => {
  setup();
  const page = render(<Page />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "编辑消息" }));
  await act(async () => {});
  fireEvent.change(screen.getByRole("textbox", { name: "消息内容" }), {
    target: { value: "编辑中的历史消息" },
  });
  page.rerender(<Page active={false} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RESOURCE_IDLE_MS * 2);
  });
  page.rerender(<Page />);
  await act(async () => {});
  expect(screen.getByRole("textbox", { name: "消息内容" })).toHaveValue(
    "编辑中的历史消息",
  );
});

it("unmounts only the hidden terminal renderer without stopping its native task", async () => {
  setup();
  const terminal = { ...task, source: "terminal", status: "running" };
  const page = (active: boolean) => (
    <TooltipProvider>
      <DetailPage
        task={terminal}
        tasks={[terminal]}
        agents={agents}
        profiles={[]}
        active={active}
        onBack={vi.fn()}
        onOpen={vi.fn()}
        onChanged={async () => {}}
        onRetry={vi.fn()}
      />
    </TooltipProvider>
  );
  const view = render(page(true));
  // Settle the lazy import without advancing live polling timers.
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  expect(screen.getByLabelText("交互终端")).toBeInTheDocument();
  view.rerender(page(false));
  expect(screen.queryByLabelText("交互终端")).not.toBeInTheDocument();
  expect(vi.mocked(call).mock.calls.some(([cmd]) => cmd === "stop_task")).toBe(
    false,
  );
  view.rerender(page(true));
  await act(async () => {});
  expect(screen.getByLabelText("交互终端")).toBeInTheDocument();
});

it("stops background workflow polling and releases its graph until the tab returns", async () => {
  const { WorkflowRunPanel } =
    await import("@/components/workspace/WorkflowRun");
  const { newWorkflow } = await import("@/lib/workflows");
  setup();
  const definition = newWorkflow(agents);
  vi.mocked(call).mockResolvedValue({
    id: "workflow-memory",
    definition,
    project: "/repo",
    status: "completed",
    cursor: 0,
    steps: definition.steps.map(() => ({
      status: "completed",
      taskIds: [],
      output: "工作流结果",
      attempts: 0,
      repairs: 0,
    })),
    revision: 1,
    llmUsage: { input: 0, output: 0, cached: 0, known: false },
    pauseRequested: false,
    feedback: "",
    error: "",
  });
  const page = (active: boolean) => (
    <WorkflowRunPanel
      task={{ ...task, id: "workflow-memory", source: "workflow" }}
      tasks={[]}
      agents={agents}
      active={active}
      onOpen={vi.fn()}
      onChanged={async () => {}}
    />
  );
  const view = render(page(true));
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  expect(screen.getByLabelText("步骤详情")).toBeInTheDocument();
  view.rerender(page(false));
  const reads = vi.mocked(call).mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RESOURCE_IDLE_MS * 2);
  });
  expect(screen.queryByLabelText("步骤详情")).not.toBeInTheDocument();
  expect(call).toHaveBeenCalledTimes(reads);
  view.rerender(page(true));
  await act(async () => {});
  expect(screen.getByLabelText("步骤详情")).toBeInTheDocument();
});
