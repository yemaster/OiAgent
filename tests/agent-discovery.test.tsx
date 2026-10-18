import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AgentsPage } from "@/pages/Agents";
import { TooltipProvider } from "@/components/ui/tooltip";
import { demoSnapshot } from "@/lib/demo";
import type { Agent } from "@/lib/types";
vi.mock("@/components/workspace/AgentQuota", () => ({
  AgentQuota: () => null,
}));

function page(patch: Partial<Agent> = {}) {
  return (
    <TooltipProvider>
      <AgentsPage
        snapshot={{
          ...demoSnapshot,
          agents: [
            {
              ...demoSnapshot.agents[0],
              available: true,
              custom: false,
              version: "",
              ...patch,
            },
          ],
        }}
        onRefresh={vi.fn()}
      />
    </TooltipProvider>
  );
}
it("does not call an installed Agent missing when its version is unknown", () => {
  render(page());
  expect(screen.getByText("版本未获取")).toBeInTheDocument();
  expect(screen.getByText("已检测到")).toBeInTheDocument();
  expect(screen.queryByText("尚未安装")).not.toBeInTheDocument();
  expect(screen.queryByText("已就绪")).not.toBeInTheDocument();
});
it("retains probe diagnostics separately and returns to ready after a successful scan", () => {
  const error = "无法安全解析此 Windows 启动脚本";
  const view = render(page({ versionError: error }));
  expect(screen.getByText("版本读取失败")).toHaveAttribute("title", error);
  expect(screen.getByText("已检测到")).toBeInTheDocument();
  view.rerender(page({ version: "codex-cli 1.2.3", versionError: null }));
  expect(screen.getByText("codex-cli 1.2.3")).toBeInTheDocument();
  expect(screen.getByText("已就绪")).toBeInTheDocument();
  expect(screen.queryByText("版本读取失败")).not.toBeInTheDocument();
});
it("handles cached timeouts from older versions without claiming the program is ready", () => {
  render(page({ version: "版本读取超时" }));
  expect(screen.getByText("版本读取失败")).toHaveAttribute(
    "title",
    "版本读取超时",
  );
  expect(screen.queryByText("已就绪")).not.toBeInTheDocument();
});
it("only describes an Agent as uninstalled when discovery did not find its path", () => {
  render(page({ available: false }));
  expect(screen.getByText("尚未安装")).toBeInTheDocument();
  expect(screen.getByText("未检测到")).toBeInTheDocument();
});
