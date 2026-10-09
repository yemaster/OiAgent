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
