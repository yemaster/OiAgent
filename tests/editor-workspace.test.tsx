import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import App from "@/App";
import { demoSnapshot } from "@/lib/demo";

it("splits live conversations, preserves drafts and closes back to the other visible group", async () => {
  localStorage.setItem("oiagent-onboarded", "true");
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  const [a, b] = demoSnapshot.tasks;
  async function openTask(title: string) {
    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog", { name: /搜索工作区/ });
    await user.clear(within(dialog).getByRole("textbox"));
    await user.type(within(dialog).getByRole("textbox"), title);
    await user.click(
      within(dialog).getByRole("button", { name: new RegExp(title) }),
    );
    await screen.findByRole("heading", { name: title });
  }
  await openTask(a.title);
  await user.type(
    await screen.findByRole("textbox", { name: "继续对话" }),
    "保留这个草稿",
  );
  await openTask(b.title);
  fireEvent.contextMenu(screen.getByRole("tab", { name: new RegExp(a.title) }));
  await user.click(screen.getByRole("menuitem", { name: "移到右侧分栏" }));
  expect(screen.getAllByRole("region", { name: "编辑器分栏" })).toHaveLength(2);
  expect(screen.getAllByRole("textbox", { name: "继续对话" })).toHaveLength(2);
  expect(screen.getByDisplayValue("保留这个草稿")).toBeVisible();
  expect(screen.getByRole("separator", { name: "调整分栏宽度" })).toBeVisible();
  expect(screen.getAllByRole("group", { name: "任务操作栏" })).toHaveLength(1);
  await user.click(
    screen.getByRole("button", { name: `关闭标签：${a.title}` }),
  );
  await waitFor(() =>
    expect(screen.getAllByRole("region", { name: "编辑器分栏" })).toHaveLength(
      1,
    ),
  );
  expect(screen.getByRole("heading", { name: b.title })).toBeVisible();
  expect(screen.getAllByRole("textbox", { name: "继续对话" })).toHaveLength(1);
});
