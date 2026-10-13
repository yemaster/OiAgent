import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { demoSnapshot } from "@/lib/demo";
import type { Snapshot, Task } from "@/lib/types";
import App from "@/App";

const state = vi.hoisted(() => ({
  snapshot: undefined as Snapshot | undefined,
  remote: {
    ready: true,
    tasks: [] as Task[],
    devices: [],
    refresh: vi.fn(),
    upsert: vi.fn(),
  },
}));
vi.mock("@/hooks/useRemoteDevices", () => ({
  useRemoteDevices: () => state.remote,
}));
vi.mock("@/lib/api", async (original) => {
  const actual = await original<typeof import("@/lib/api")>();
  return {
    ...actual,
    call: (command: string, args?: Record<string, unknown>) =>
      command === "get_snapshot"
        ? Promise.resolve(state.snapshot)
        : actual.call(command, args),
  };
});
beforeEach(() => {
  localStorage.clear();
  state.snapshot = {
    ...demoSnapshot,
    tasks: demoSnapshot.tasks.map((task) => ({ ...task, status: "completed" })),
  };
  state.remote.ready = true;
  state.remote.tasks = [];
});
it("starts in the composer when no unfinished tasks exist, without a synthetic back entry", async () => {
  render(<App />);
  expect(
    await screen.findByRole("textbox", { name: "任务内容" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "欢迎使用 OiAgent" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "返回上一页" }),
  ).not.toBeInTheDocument();
  const sidebar = screen.getByRole("complementary", { name: "侧边导航" });
  expect(
    within(sidebar).getByRole("button", { name: /新建任务/ }),
  ).toHaveAttribute("aria-current", "page");
  const rail = screen.getByRole("navigation", { name: "工具栏" });
  expect(rail.style.getPropertyValue("--sidebar")).not.toBe(
    sidebar.style.getPropertyValue("--sidebar"),
  );
});
it.each(["running", "waiting", "queued"] as const)(
  "opens current tasks for %s without waiting on LAN",
  async (status) => {
    state.snapshot!.tasks = [{ ...demoSnapshot.tasks[0], status }];
    state.remote.ready = false;
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "当前任务" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "返回上一页" }),
    ).not.toBeInTheDocument();
  },
);
it("uses remote tasks for startup but never interrupts a draft when LAN finishes later", async () => {
  state.remote.tasks = [{ ...demoSnapshot.tasks[0], deviceId: "peer" }];
  const first = render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  first.unmount();
  state.remote.tasks = [];
  state.remote.ready = false;
  const view = render(<App />);
  const user = userEvent.setup();
  await user.type(
    await screen.findByRole("textbox", { name: "任务内容" }),
    "保留草稿",
  );
  state.remote.ready = true;
  state.remote.tasks = [{ ...demoSnapshot.tasks[0], deviceId: "peer" }];
  view.rerender(<App />);
  expect(screen.getByRole("textbox", { name: "任务内容" })).toHaveValue(
    "保留草稿",
  );
  expect(
    screen.queryByRole("heading", { name: "当前任务" }),
  ).not.toBeInTheDocument();
});

it("keeps the first manual navigation in history while LAN is still loading", async () => {
  state.remote.ready = false;
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("textbox", { name: "任务内容" });
  await user.click(
    within(screen.getByRole("complementary", { name: "侧边导航" })).getByRole(
      "button",
      { name: "历史记录", exact: true },
    ),
  );
  await screen.findByRole("heading", { name: "历史记录" });
  await user.click(screen.getByRole("button", { name: "返回上一页" }));
  expect(
    await screen.findByRole("textbox", { name: "任务内容" }),
  ).toBeVisible();
});
