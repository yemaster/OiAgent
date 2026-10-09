import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it } from "vitest";
import App from "@/App";
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("oiagent-onboarded", "true");
});
it("opens a dedicated API page and retains its draft across navigation", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  const rail = within(screen.getByRole("navigation", { name: "工具栏" }));
  await user.click(
    rail.getByRole("button", { name: "Agent 程序", exact: true }),
  );
  const sidebar = within(
    screen.getByRole("complementary", { name: "侧边导航" }),
  );
  await user.click(
    sidebar.getByRole("button", { name: "Claude Code API 配置" }),
  );
  await user.click(screen.getByRole("button", { name: "添加 API" }));
  await screen.findByRole("heading", { name: "添加 Claude Code API" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    sidebar.getByRole("button", { name: "Claude Code API 配置" }),
  ).toHaveAttribute("aria-current", "page");
  await user.type(screen.getByLabelText("名称"), "Unsaved API");
  await user.type(screen.getByLabelText("Fable"), "gateway-fable");
  await user.type(screen.getByLabelText("API Key"), "test-only-memory-key");
  await user.click(rail.getByRole("button", { name: "设置偏好" }));
  await user.click(rail.getByRole("button", { name: "返回上一页" }));
  expect(screen.getByLabelText("名称")).toHaveValue("Unsaved API");
  expect(screen.getByLabelText("Fable")).toHaveValue("gateway-fable");
  expect(screen.getByLabelText("API Key")).toHaveValue("test-only-memory-key");
  expect(Object.values(localStorage).join(" ")).not.toContain(
    "test-only-memory-key",
  );
  await user.click(screen.getByRole("button", { name: "返回 API 配置" }));
  await screen.findByRole("heading", { name: "Claude Code API 配置" });
});
