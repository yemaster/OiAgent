import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { About } from "@/components/workspace/About";
import { WorkspaceNavigation } from "@/components/workspace/Navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
import { checkAppUpdate, useBackgroundUpdateCheck } from "@/lib/appUpdates";
vi.mock("@/lib/api", () => ({ desktop: true, call: vi.fn() }));
const latest = {
  currentVersion: "1.0.0",
  latestVersion: "1.1.0",
  updateAvailable: true,
  releaseUrl: "https://github.com/yemaster/OiAgent/releases/tag/v1.1.0",
};
beforeEach(async () => {
  vi.mocked(call)
    .mockReset()
    .mockImplementation(async (command) => {
      if (command === "app_info")
        return { version: "1.0.0", os: "macos", arch: "aarch64" };
      if (command === "check_app_update")
        return { ...latest, updateAvailable: false };
      return undefined;
    });
  await checkAppUpdate();
  vi.mocked(call).mockClear();
});
it("checks from About, shares its update badge and opens the exact release", async () => {
  vi.mocked(call).mockImplementation(async (command) => {
    if (command === "app_info")
      return { version: "1.0.0", os: "macos", arch: "aarch64" };
    if (command === "check_app_update") return latest;
    return undefined;
  });
  const user = userEvent.setup();
  render(
    <TooltipProvider>
      <About />
      <WorkspaceNavigation
        page="settings-about"
        project="all"
        snapshot={demoSnapshot}
        sidebar
        onNavigate={vi.fn()}
        onProject={vi.fn()}
        onAddProject={vi.fn()}
        onSearch={vi.fn()}
        onExpand={vi.fn()}
      />
    </TooltipProvider>,
  );
  expect(await screen.findByText("版本 1.0.0")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "检查更新" }));
  const release = await screen.findByRole("link", {
    name: /有新版本更新 · 1.1.0/,
  });
  expect(release).toHaveAttribute("href", latest.releaseUrl);
  const settings = within(
    screen.getByRole("navigation", { name: "工具栏" }),
  ).getByRole("button", { name: "设置偏好" });
  expect(
    within(settings).getByRole("img", { name: "有新版本更新" }),
  ).toBeVisible();
  await user.click(release);
  expect(call).toHaveBeenCalledWith("open_conversation_link", {
    url: latest.releaseUrl,
  });
  expect(
    screen.queryByRole("button", { name: "检查更新" }),
  ).not.toBeInTheDocument();
  vi.mocked(call).mockResolvedValue({ ...latest, updateAvailable: false });
  await act(async () => {
    await checkAppUpdate();
  });
  expect(await screen.findByText("已是最新版本")).toBeVisible();
  expect(screen.getByRole("button", { name: "检查更新" })).toBeVisible();
  expect(within(settings).queryByRole("img")).not.toBeInTheDocument();
});
it("deduplicates checks and shows a retryable error instead of a false success", async () => {
  let reject!: (error: string) => void;
  vi.mocked(call).mockImplementation((command) =>
    command === "check_app_update"
      ? new Promise((_, fail) => {
          reject = fail;
        })
      : Promise.resolve({ version: "1.0.0", os: "macos", arch: "aarch64" }),
  );
  const user = userEvent.setup();
  render(<About />);
  await user.click(screen.getByRole("button", { name: "检查更新" }));
  expect(screen.getByRole("button", { name: "正在检查…" })).toBeDisabled();
  const pending = checkAppUpdate();
  expect(
    vi.mocked(call).mock.calls.filter(([name]) => name === "check_app_update"),
  ).toHaveLength(1);
  await act(async () => {
    reject("检查失败，请检查网络后重试");
    await pending;
  });
  expect(screen.getByText("检查失败，请检查网络后重试")).toBeVisible();
  expect(screen.queryByText("已是最新版本")).not.toBeInTheDocument();
  vi.mocked(call).mockResolvedValue({ ...latest, updateAvailable: false });
  await user.click(screen.getByRole("button", { name: "检查更新" }));
  await waitFor(() => expect(screen.getByText("已是最新版本")).toBeVisible());
});
it("does not repeat a recent manual check during startup", async () => {
  vi.useFakeTimers();
  function Background() {
    useBackgroundUpdateCheck();
    return null;
  }
  const view = render(<Background />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(call).not.toHaveBeenCalled();
  view.unmount();
  vi.useRealTimers();
});
