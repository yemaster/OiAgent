import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { WorkspaceStatusBar } from "@/components/workspace/WorkspaceStatusBar";
vi.mock("@/lib/api", () => ({ desktop: true }));
const props = {
  activeCount: 3,
  availableAgents: 2,
  dataDir: "/data/OiAgent",
  refreshing: false,
  autoRefresh: true,
  warnings: [],
  error: "",
  onTasks: vi.fn(),
  onNavigate: vi.fn(),
  onRefresh: vi.fn(),
};
beforeEach(() => vi.clearAllMocks());
it("opens connection details and routes status actions without leaving popovers open", () => {
  render(<WorkspaceStatusBar {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "本地连接" }));
  expect(screen.getByRole("dialog", { name: "连接信息" })).toBeVisible();
  expect(screen.getByText("/data/OiAgent")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "局域网连接" }));
  expect(props.onNavigate).toHaveBeenCalledWith("settings-lan");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "3 个活跃任务" }));
  expect(props.onTasks).toHaveBeenCalledOnce();
});
it("shows full sync warnings, permits retry and prevents duplicate refreshes", () => {
  const warnings = ["无法读取 /projects/one", "无法读取 /projects/two"];
  const { rerender } = render(
    <WorkspaceStatusBar {...props} warnings={warnings} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "2 个目录读取提示" }));
  for (const warning of warnings)
    expect(screen.getByText(warning)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "立即同步" }));
  expect(props.onRefresh).toHaveBeenCalledOnce();
  rerender(<WorkspaceStatusBar {...props} refreshing warnings={warnings} />);
  expect(
    screen
      .getAllByRole("button", { name: "正在同步…" })
      .find((button) => button.hasAttribute("disabled")),
  ).toBeDefined();
  rerender(<WorkspaceStatusBar {...props} error="读取失败" />);
  expect(screen.getByRole("alert")).toHaveTextContent("读取失败");
  fireEvent.click(screen.getByRole("button", { name: "同步设置" }));
  expect(props.onNavigate).toHaveBeenCalledWith("settings");
});
