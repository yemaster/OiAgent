import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import App from "@/App";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
import { projectMarkKey } from "@/lib/organization";

it("pins sidebar projects above recent projects, persists color, and does not offer project archive", async () => {
  localStorage.setItem("oiagent-onboarded", "true");
  localStorage.removeItem("oiagent-workspace-marks");
  const user = userEvent.setup();
  const view = render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  const sidebar = screen.getByRole("complementary", { name: "侧边导航" });
  const path = demoSnapshot.projects.at(-1)!;
  const name = path.split("/").at(-1)!;
  await waitFor(() =>
    expect(
      within(sidebar).getByRole("button", { name: `置顶：${name}` }),
    ).toBeEnabled(),
  );
  await user.click(
    within(sidebar).getByRole("button", { name: `置顶：${name}` }),
  );
  await within(sidebar).findByRole("button", { name: `取消置顶：${name}` });
  expect(sidebar.querySelectorAll('button[title^="/"]')[0]).toHaveAttribute(
    "title",
    path,
  );
  expect(
    within(sidebar).queryByRole("button", { name: /^归档/ }),
  ).not.toBeInTheDocument();
  await user.click(
    within(sidebar).getByRole("button", { name: `颜色标记：${name}` }),
  );
  await user.click(screen.getByRole("button", { name: "蓝色", exact: true }));
  await waitFor(() =>
    expect(
      JSON.parse(localStorage.getItem("oiagent-workspace-marks")!)[
        projectMarkKey(path)
      ],
    ).toEqual({ pinned: true, color: "blue" }),
  );
  await user.keyboard("{Escape}");
  view.unmount();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  const reopened = screen.getByRole("complementary", { name: "侧边导航" });
  await within(reopened).findByRole("button", { name: `取消置顶：${name}` });
  expect(
    within(reopened).getByRole("img", { name: "蓝色标记" }),
  ).toBeInTheDocument();
});

it("selects archived conversations, resets selection across filters, and only deletes after confirmation", async () => {
  const targets = demoSnapshot.tasks
    .filter(
      (t) =>
        !["running", "waiting", "queued"].includes(t.status) && !t.parentId,
    )
    .slice(0, 2);
  expect(targets).toHaveLength(2);
  for (const task of targets)
    await call("archive_task", { id: task.id, archived: true });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  await user.click(
    within(screen.getByRole("complementary", { name: "侧边导航" })).getByRole(
      "button",
      { name: "历史记录", exact: true },
    ),
  );
  await user.click(screen.getByRole("tab", { name: "已归档" }));
  await user.click(screen.getByRole("checkbox", { name: /^全选筛选结果/ }));
  expect(screen.getByText("已选 2 条")).toBeInTheDocument();
  const search = screen.getByRole("textbox", { name: "搜索任务" });
  await user.type(search, targets[0].title);
  expect(screen.getByRole("button", { name: "删除所选" })).toBeDisabled();
  await user.clear(search);
  expect(screen.getByRole("button", { name: "删除所选" })).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /^全选筛选结果/ }));
  await user.click(screen.getByRole("button", { name: "删除所选" }));
  let dialog = await screen.findByRole("dialog", {
    name: "删除 2 条归档会话？",
  });
  await user.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(
    screen.getByRole("button", { name: `打开会话：${targets[0].title}` }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "删除所选" }));
  dialog = await screen.findByRole("dialog", { name: "删除 2 条归档会话？" });
  await user.click(within(dialog).getByRole("button", { name: "确认删除" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: `打开会话：${targets[0].title}` }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("button", { name: `打开会话：${targets[1].title}` }),
  ).not.toBeInTheDocument();
});
