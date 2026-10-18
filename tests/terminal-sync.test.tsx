import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DetailPage } from "@/pages/Detail";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  call: vi.fn(),
  desktop: false,
  exportText: vi.fn(),
}));
vi.mock("@/components/workspace/TerminalView", () => ({
  TerminalView: () => <div aria-label="交互终端" />,
}));

it("refreshes a completed conversation while its TUI runs and immediately on view switches", async () => {
  const user = userEvent.setup();
  const owner = {
    ...demoSnapshot.tasks[0],
    id: "owner",
    agentKind: "claude",
    source: "managed",
    status: "completed",
    terminalId: "pty",
  };
  const terminal = {
    ...owner,
    id: "pty",
    source: "terminal",
    status: "running",
    parentId: "owner",
  };
  let text = "已有对话内容";
  vi.mocked(call).mockImplementation(async () => ({
    task: owner,
    log: "",
    messages: [{ role: "assistant", text, timestamp: "" }],
  }));
  render(
    <TooltipProvider>
      <DetailPage
        task={owner}
        tasks={[owner, terminal]}
        agents={demoSnapshot.agents}
        profiles={[]}
        onBack={vi.fn()}
        onOpen={vi.fn()}
        onChanged={async () => {}}
        onRetry={vi.fn()}
      />
    </TooltipProvider>,
  );
  await screen.findByText("已有对话内容");
  text = "终端新增内容";
  await waitFor(() => expect(screen.getByText("终端新增内容")).toBeVisible(), {
    timeout: 1800,
  });
  await user.click(screen.getByRole("tab", { name: "终端", exact: true }));
  await screen.findByLabelText("交互终端");
  expect(screen.queryByText(/终端已连接 · 输入和滚动/)).not.toBeInTheDocument();
  text = "切回时的最新内容";
  await user.click(screen.getByRole("tab", { name: "对话", exact: true }));
  await screen.findByText("切回时的最新内容");
});

it("releases cached terminal input ownership when the conversation detaches it", async () => {
  const user = userEvent.setup();
  let owner = {
    ...demoSnapshot.tasks[0],
    id: "owner",
    agentKind: "claude",
    source: "managed",
    status: "completed",
    terminalId: undefined as string | undefined,
    updatedAt: "2030-01-01T00:00:00Z",
  };
  const terminal = {
    ...owner,
    id: "pty",
    source: "terminal",
    status: "running",
    parentId: owner.id,
    updatedAt: "2030-01-01T00:00:01Z",
  };
  vi.mocked(call).mockImplementation(async (command) => {
    if (command === "connect_agent_terminal") {
      owner = {
        ...owner,
        terminalId: terminal.id,
        updatedAt: terminal.updatedAt,
      };
      return terminal;
    }
    if (command === "task_approvals") return [];
    if (command === "task_artifacts") return { files: [], truncated: false };
    return { task: owner, log: "", messages: [] };
  });
  const view = () => (
    <TooltipProvider>
      <DetailPage
        task={owner}
        tasks={[]}
        agents={demoSnapshot.agents}
        profiles={[]}
        onBack={vi.fn()}
        onOpen={vi.fn()}
        onChanged={async () => {
          result.rerender(view());
        }}
        onRetry={vi.fn()}
      />
    </TooltipProvider>
  );
  const result = render(view());
  await user.click(screen.getByRole("tab", { name: "终端", exact: true }));
  await user.click(screen.getByRole("button", { name: "连接 Agent 终端" }));
  await screen.findByLabelText("交互终端");
  await user.click(screen.getByRole("tab", { name: "对话", exact: true }));
  expect(
    screen.queryByRole("textbox", { name: "继续对话" }),
  ).not.toBeInTheDocument();

  owner = {
    ...owner,
    terminalId: undefined,
    status: "cancelled",
    updatedAt: "2030-01-01T00:00:02Z",
  };
  result.rerender(view());
  expect(
    await screen.findByRole("textbox", { name: "继续对话" }),
  ).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "发送消息", exact: true }),
  ).toBeVisible();
  expect(
    screen.queryByText("当前会话由终端接管输入。"),
  ).not.toBeInTheDocument();
});

it("uses conditional detail polling, keeps the transcript on an unchanged response and pauses hidden tabs", async () => {
  const owner = {
    ...demoSnapshot.tasks[0],
    id: "conditional",
    status: "running",
  };
  let text = "原来的消息";
  vi.mocked(call).mockImplementation(async (command, args) => {
    if (command !== "get_detail") return [];
    if (args?.knownVersion === text) return null;
    return {
      task: owner,
      log: "",
      revision: text,
      contentVersion: text,
      messages: [{ role: "assistant", text, timestamp: "" }],
    };
  });
  const page = (active: boolean) => (
    <TooltipProvider>
      <DetailPage
        task={owner}
        tasks={[owner]}
        agents={demoSnapshot.agents}
        profiles={[]}
        onBack={vi.fn()}
        onOpen={vi.fn()}
        onChanged={async () => {}}
        onRetry={vi.fn()}
        active={active}
      />
    </TooltipProvider>
  );
  const view = render(page(true));
  await screen.findByText(text);
  await waitFor(
    () =>
      expect(call).toHaveBeenCalledWith("get_detail", {
        id: "conditional",
        knownVersion: text,
      }),
    { timeout: 1800 },
  );
  expect(screen.getByText(text)).toBeVisible();
  view.rerender(page(false));
  vi.mocked(call).mockClear();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  expect(
    vi.mocked(call).mock.calls.filter(([command]) => command === "get_detail"),
  ).toHaveLength(0);
  text = "重新打开后的最新消息";
  view.rerender(page(true));
  await screen.findByText(text);
  expect(call).toHaveBeenCalledWith("get_detail", { id: "conditional" });
});
