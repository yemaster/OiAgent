import { expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "@/App";
import { changeBrowserWorkflow, newWorkflow } from "@/lib/workflows";
import { demoSnapshot } from "@/lib/demo";
it("keeps schedule drafts separate and restores the previous editor through back navigation", async () => {
  localStorage.clear();
  localStorage.setItem("oiagent-onboarded", "true");
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  await user.click(
    within(screen.getByRole("navigation", { name: "工具栏" })).getByRole(
      "button",
      { name: "自动化" },
    ),
  );
  await user.click(
    within(screen.getByRole("complementary", { name: "侧边导航" })).getByRole(
      "button",
      { name: "定时任务", exact: true },
    ),
  );
  await user.click(screen.getByRole("button", { name: "新建定时任务" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("名称", { exact: true }), "第一份计划");
  await user.click(screen.getByRole("button", { name: "返回定时任务" }));
  await user.click(screen.getByRole("button", { name: "新建定时任务" }));
  await user.type(screen.getByLabelText("名称", { exact: true }), "第二份计划");
  await user.click(screen.getByRole("button", { name: "返回上一页" }));
  await user.click(screen.getByRole("button", { name: "返回上一页" }));
  expect(screen.getByLabelText("名称", { exact: true })).toHaveValue(
    "第一份计划",
  );
});

it("opens a saved workflow directly in the schedule editor", async () => {
  localStorage.clear();
  localStorage.setItem("oiagent-onboarded", "true");
  changeBrowserWorkflow("save_workflow", {
    definition: {
      ...newWorkflow(demoSnapshot.agents, "implement"),
      name: "每日审查",
      goal: "检查项目",
    },
  });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  await user.click(
    within(screen.getByRole("navigation", { name: "工具栏" })).getByRole(
      "button",
      { name: "自动化" },
    ),
  );
  await user.click(
    await screen.findByRole("button", { name: "更多操作：每日审查" }),
  );
  await user.click(screen.getByRole("menuitem", { name: "定时执行" }));
  expect(screen.getByLabelText("名称", { exact: true })).toHaveValue(
    "每日审查",
  );
  expect(
    screen.getByRole("combobox", { name: "定时执行的工作流" }),
  ).toHaveTextContent("每日审查");
});
