import { beforeEach, expect, it } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "@/App";
import {
  browserWorkflows,
  changeBrowserWorkflow,
  newWorkflow,
  validateWorkflow,
} from "@/lib/workflows";
import { demoSnapshot } from "@/lib/demo";
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("oiagent-onboarded", "true");
});
it("saves reusable workflows with revision checks and rejects invalid repair targets", () => {
  const value = {
    ...newWorkflow(demoSnapshot.agents, "implement"),
    goal: "检查登录",
  };
  const saved = changeBrowserWorkflow("save_workflow", { definition: value })!;
  expect(browserWorkflows().definitions).toHaveLength(1);
  expect(saved.revision).toBe(1);
  changeBrowserWorkflow("save_workflow", {
    definition: { ...saved, name: "新的名称" },
  });
  expect(() =>
    changeBrowserWorkflow("save_workflow", { definition: saved }),
  ).toThrow("已修改");
  value.steps[1] = { ...value.steps[1], kind: "review", maxRepairs: 1 };
  expect(validateWorkflow(value)).toBe("");
  value.steps[0].kind = "approval";
  expect(validateWorkflow(value)).toContain("自动返工须紧跟 Agent");
});
it("uses a separate editor, keeps drafts through settings and preserves independent editor history", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  const rail = within(screen.getByRole("navigation", { name: "工具栏" }));
  await user.click(rail.getByRole("button", { name: "自动化" }));
  await user.click(
    screen.getByRole("button", { name: "分析 → 确认 → 实现 → 检查" }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("任务目标"), "为登录接口补上测试");
  expect(
    within(screen.getByRole("complementary", { name: "侧边导航" })).getByRole(
      "button",
      { name: "工作流", exact: true },
    ),
  ).toHaveAttribute("aria-current", "page");
  await user.click(screen.getByRole("button", { name: "LLM API 设置" }));
  await user.click(await screen.findByRole("button", { name: "返回工作流" }));
  expect(screen.getByLabelText("任务目标")).toHaveValue("为登录接口补上测试");
  expect(
    screen.getByRole("button", { name: "启动", exact: true }),
  ).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "保存工作流" }));
  await waitFor(() => expect(browserWorkflows().definitions).toHaveLength(1));
  await user.click(screen.getByRole("button", { name: "返回", exact: true }));
  await user.click(screen.getByRole("button", { name: "新建工作流" }));
  await user.type(screen.getByLabelText("名称", { exact: true }), "另一份草稿");
  await user.click(rail.getByRole("button", { name: "返回上一页" }));
  await user.click(rail.getByRole("button", { name: "返回上一页" }));
  expect(screen.getByLabelText("名称", { exact: true })).toHaveValue(
    "分析、实现与验证",
  );
  expect(screen.getByLabelText("任务目标")).toHaveValue("为登录接口补上测试");
});
