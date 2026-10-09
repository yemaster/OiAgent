import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it } from "vitest";
import App from "@/App";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("oiagent-onboarded", "true");
});

it("separates settings pages while keeping the settings rail active", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  const rail = within(screen.getByRole("navigation", { name: "工具栏" }));
  const settings = rail.getByRole("button", { name: "设置偏好" });
  await user.click(settings);
  const sidebar = within(
    screen.getByRole("complementary", { name: "侧边导航" }),
  );
  expect(sidebar.queryByText("OiAgent")).not.toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "通用设置" })).toBeVisible(),
  );
  expect(
    screen.getByRole("switch", { name: "自动同步历史记录" }),
  ).toBeVisible();
  expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
  for (const page of ["界面设置", "LLM API", "关于"]) {
    await user.click(sidebar.getByRole("button", { name: page, exact: true }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: page })).toBeVisible(),
    );
    expect(settings).toHaveAttribute("aria-current", "page");
    expect(
      sidebar.getByRole("button", { name: page, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.queryByRole("switch", { name: "自动同步历史记录" }),
    ).not.toBeInTheDocument();
  }
});

it("retains API edits and the originating task draft across settings pages", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  await user.click(
    within(screen.getByRole("navigation", { name: "工具栏" })).getByRole(
      "button",
      { name: "自动化" },
    ),
  );
  await user.type(
    screen.getByRole("textbox", { name: "任务目标" }),
    "保留这个任务草稿",
  );
  await user.click(screen.getByRole("button", { name: /配置 LLM API/ }));
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "LLM API" })).toBeVisible(),
  );
  await user.type(
    screen.getByLabelText("API Base URL"),
    "https://example.test/v1",
  );
  await user.type(screen.getByLabelText("API Key"), "unsaved-test-key");
  const sidebar = within(
    screen.getByRole("complementary", { name: "侧边导航" }),
  );
  await user.click(sidebar.getByRole("button", { name: "界面设置" }));
  await user.click(sidebar.getByRole("button", { name: "LLM API" }));
  expect(screen.getByLabelText("API Base URL")).toHaveValue(
    "https://example.test/v1",
  );
  expect(screen.getByLabelText("API Key")).toHaveValue("unsaved-test-key");
  expect(Object.values(localStorage)).not.toContain("unsaved-test-key");
  await user.click(screen.getByRole("button", { name: "返回新建任务" }));
  expect(screen.getByRole("textbox", { name: "任务目标" })).toHaveValue(
    "保留这个任务草稿",
  );
});
