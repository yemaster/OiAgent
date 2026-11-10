import { StrictMode } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { StorageSettings } from "@/components/workspace/StorageSettings";
import type { StorageItem, StorageReport } from "@/lib/storage";

const api = vi.hoisted(() => ({ call: vi.fn(), desktop: true }));
vi.mock("@/lib/api", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const item: StorageItem = {
  id: "project:a",
  category: "conversations",
  name: "临时研究",
  paths: ["/app/temporary-projects/a"],
  bytes: 1024,
  revision: "rev-a",
  blockedReason: null,
  effect: "永久删除此临时对话的文件和 OiAgent 对话记录",
  cleanupAfter: null,
  partial: false,
};
function report(items = [item]): StorageReport {
  return {
    dataDir: "/app",
    totalBytes: items.reduce((n, item) => n + item.bytes, 0),
    cleanableBytes: items
      .filter((item) => !item.blockedReason)
      .reduce((n, item) => n + item.bytes, 0),
    items,
    partial: false,
    retentionDays: 30,
  };
}
const props = {
  openProjects: [] as string[],
  onDeleted: vi.fn(async () => {}),
  onOpenArchive: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  api.desktop = true;
  api.call.mockImplementation(async (name: string) => {
    if (name === "scan_storage") return report();
    if (name === "delete_storage_items")
      return {
        deletedItems: [item.id],
        deletedIds: ["task-a"],
        deletedProjects: [item.paths[0]],
        failures: [],
      };
    throw new Error(name);
  });
});
async function choose() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /临时对话/ }));
  await user.click(screen.getByRole("checkbox", { name: "选择 临时研究" }));
  await user.click(screen.getByRole("button", { name: "删除所选项目" }));
  return user;
}

it("keeps the overview concise and exposes scope and rules only on demand", async () => {
  render(<StorageSettings {...props} />);
  const user = userEvent.setup();
  expect((await screen.findAllByText("1 KB"))[0]).toBeVisible();
  expect(screen.getByText("归档 30 天后")).toBeVisible();
  expect(screen.queryByText(/不包含安装包/)).not.toBeInTheDocument();
  expect(screen.queryByText("/app")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Agent 运行组件/ }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "统计范围" }));
  expect(screen.getByText(/不包含安装包/)).toBeVisible();
  expect(screen.getByText("/app")).toBeVisible();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "自动清理规则" }));
  expect(screen.getByText(/下次启动时清理文件/)).toBeVisible();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: /临时对话/ }));
  expect(
    screen.getByRole("checkbox", { name: "选择 临时研究" }),
  ).not.toBeChecked();
  expect(screen.getByRole("button", { name: "删除所选项目" })).toBeDisabled();
  expect(api.call).not.toHaveBeenCalledWith(
    "delete_storage_items",
    expect.anything(),
  );
});

it("lists exact paths and deletion effects; cancelling never calls deletion", async () => {
  render(<StorageSettings {...props} />);
  const user = await choose();
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByText(item.paths[0])).toBeVisible();
  expect(dialog.getByText(item.effect)).toBeVisible();
  expect(dialog.getByRole("button", { name: "取消" })).toHaveFocus();
  await user.click(dialog.getByRole("button", { name: "取消" }));
  expect(api.call).not.toHaveBeenCalledWith(
    "delete_storage_items",
    expect.anything(),
  );
  expect(screen.getByRole("button", { name: "删除所选项目" })).toHaveFocus();
});

it("deletes only confirmed IDs/revisions and uses current open editors before refreshing", async () => {
  const view = render(<StorageSettings {...props} />);
  const user = await choose();
  view.rerender(
    <StorageSettings
      {...props}
      openProjects={["/app/temporary-projects/new-open-editor"]}
    />,
  );
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "永久删除",
    }),
  );
  expect(api.call).toHaveBeenCalledWith("delete_storage_items", {
    items: [{ id: item.id, revision: item.revision }],
    confirmed: true,
    openProjects: ["/app/temporary-projects/new-open-editor"],
  });
  await waitFor(() =>
    expect(props.onDeleted).toHaveBeenCalledWith(["task-a"], [item.paths[0]]),
  );
  expect(
    api.call.mock.calls.filter(([name]) => name === "scan_storage"),
  ).toHaveLength(2);
  expect(
    screen.queryByRole("button", { name: "删除所选项目" }),
  ).not.toBeInTheDocument();
});

it("disables protected items and offers the existing archive manager", async () => {
  api.call.mockResolvedValue(
    report([
      {
        ...item,
        id: "protected:logs",
        category: "records",
        name: "会话日志",
        blockedReason: "请在归档中管理",
      },
      {
        ...item,
        id: "project:kept",
        category: "kept",
        name: "保留目录",
        blockedReason: "已保留的项目",
      },
    ]),
  );
  render(<StorageSettings {...props} />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: /会话记录与日志/ }),
  );
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "会话日志的详情" }));
  expect(screen.getByText("请在归档中管理")).toBeVisible();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "管理归档记录" }));
  expect(props.onOpenArchive).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: /已保留项目/ }));
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByText("已保留")).toBeVisible();
});

it("reports partial deletion failures and rescans instead of claiming everything succeeded", async () => {
  api.call.mockImplementation(async (name: string) =>
    name === "scan_storage"
      ? report()
      : {
          deletedItems: [],
          deletedIds: [],
          deletedProjects: [],
          failures: [{ id: item.id, message: "文件已变化，请重新扫描" }],
        },
  );
  render(<StorageSettings {...props} />);
  const user = await choose();
  await user.click(screen.getByRole("button", { name: "永久删除" }));
  expect(
    await screen.findByText("临时研究：文件已变化，请重新扫描"),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "删除所选项目" }),
  ).not.toBeInTheDocument();
  expect(props.onDeleted).toHaveBeenCalledWith([], []);
});

it("keeps errors recoverable and does not allow double submission while deleting", async () => {
  let reject!: (reason: Error) => void;
  api.call.mockImplementation((name: string) =>
    name === "scan_storage"
      ? Promise.resolve(report())
      : new Promise((_, no) => {
          reject = no;
        }),
  );
  render(<StorageSettings {...props} />);
  const user = await choose();
  await user.dblClick(screen.getByRole("button", { name: "永久删除" }));
  expect(screen.getByRole("button", { name: "正在删除…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(
    api.call.mock.calls.filter(([name]) => name === "delete_storage_items"),
  ).toHaveLength(1);
  await act(async () => reject(new Error("无法删除，文件已保护")));
  expect(
    within(screen.getByRole("dialog")).getByRole("alert"),
  ).toHaveTextContent("文件已保护");
  expect(screen.getByRole("button", { name: "取消" })).toBeEnabled();
});

it("bounds large lists to 50 rows and preserves selections between pages", async () => {
  api.call.mockResolvedValue(
    report(
      Array.from({ length: 120 }, (_, i) => ({
        ...item,
        id: `project:${i}`,
        name: `项目 ${i}`,
      })),
    ),
  );
  render(<StorageSettings {...props} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /临时对话/ }));
  expect(
    within(screen.getByRole("list", { name: "存储项目" })).getAllByRole(
      "checkbox",
    ),
  ).toHaveLength(50);
  await user.click(
    screen.getByRole("checkbox", { name: "选择 项目 0", exact: true }),
  );
  await user.click(screen.getByRole("button", { name: "下一页" }));
  expect(
    screen.queryByRole("checkbox", { name: "选择 项目 0", exact: true }),
  ).not.toBeInTheDocument();
  expect(
    within(screen.getByRole("list", { name: "存储项目" })).getAllByRole(
      "checkbox",
    ),
  ).toHaveLength(50);
  await user.click(screen.getByRole("button", { name: "上一页" }));
  expect(
    screen.getByRole("checkbox", { name: "选择 项目 0", exact: true }),
  ).toBeChecked();
});

it("deduplicates StrictMode analysis and never starts periodic scans", async () => {
  let resolve!: (report: StorageReport) => void;
  api.call.mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const view = render(
    <StrictMode>
      <StorageSettings {...props} />
    </StrictMode>,
  );
  expect(api.call).toHaveBeenCalledTimes(1);
  await act(async () => resolve(report()));
  expect(screen.getByRole("button", { name: "重新分析" })).toBeEnabled();
  view.rerender(
    <StrictMode>
      <StorageSettings {...props} openProjects={["changed"]} />
    </StrictMode>,
  );
  expect(api.call).toHaveBeenCalledTimes(1);
});

it("shows scan failures with retry and no fabricated zero-size result", async () => {
  api.call.mockRejectedValueOnce(new Error("目录不可读"));
  render(<StorageSettings {...props} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("目录不可读");
  expect(
    screen.queryByRole("button", { name: "删除所选项目" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "重新分析" }));
  expect(await screen.findByRole("button", { name: /临时对话/ })).toBeEnabled();
});

it("does not fake disk usage in browser mode", () => {
  api.desktop = false;
  render(<StorageSettings {...props} />);
  expect(screen.getByText(/需要在桌面版/)).toBeVisible();
  expect(api.call).not.toHaveBeenCalled();
});

it("opens cleanable items directly and keeps protected data out of bulk selection", async () => {
  const locked = {
    ...item,
    id: "project:locked",
    name: "正在运行",
    bytes: 4096,
    blockedReason: "仍有运行中的任务",
  };
  const available = {
    ...item,
    id: "project:available",
    name: "可以删除",
    category: "projects",
    bytes: 2048,
  };
  api.call.mockResolvedValue(report([item, locked, available]));
  render(<StorageSettings {...props} />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "清理空间", exact: true }),
  );
  const list = within(screen.getByRole("list", { name: "存储项目" }));
  expect(list.queryByText("正在运行")).not.toBeInTheDocument();
  expect(list.getAllByRole("checkbox")).toHaveLength(2);
  await user.click(
    screen.getByRole("checkbox", { name: "选择本页可清理项目" }),
  );
  expect(screen.getByText("已选 2 项 · 3 KB")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "删除所选项目" }));
  expect(
    screen.getByRole("heading", { name: "永久删除所选 2 项？" }),
  ).toBeVisible();
  expect(
    api.call.mock.calls.some(([name]) => name === "delete_storage_items"),
  ).toBe(false);
});

it("searches names and paths, sorts items and retains selection when filters change", async () => {
  const alpha = {
    ...item,
    id: "project:alpha",
    name: "Alpha",
    paths: ["/app/temporary-projects/alpha-file"],
    bytes: 512,
  };
  const zulu = {
    ...item,
    id: "project:zulu",
    name: "Zulu",
    paths: ["/app/temporary-projects/zulu-file"],
    bytes: 8192,
  };
  api.call.mockResolvedValue(report([alpha, zulu]));
  render(<StorageSettings {...props} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /临时对话/ }));
  const rows = () =>
    within(screen.getByRole("list", { name: "存储项目" })).getAllByRole(
      "listitem",
    );
  expect(rows()[0]).toHaveTextContent("Zulu");
  await user.click(screen.getByRole("combobox", { name: "排序" }));
  await user.click(screen.getByRole("option", { name: "名称排序" }));
  expect(rows()[0]).toHaveTextContent("Alpha");
  await user.click(screen.getByRole("checkbox", { name: "选择 Alpha" }));
  const search = screen.getByRole("textbox", { name: "搜索存储项目" });
  await user.type(search, "zulu-file");
  expect(rows()).toHaveLength(1);
  expect(rows()[0]).toHaveTextContent("Zulu");
  expect(screen.getByText("已选 1 项 · 512 B")).toBeVisible();
  await user.clear(search);
  expect(screen.getByRole("checkbox", { name: "选择 Alpha" })).toBeChecked();
  await user.type(search, "missing-file");
  expect(screen.getByText("没有匹配的项目")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "清空", exact: true }));
  expect(screen.getByRole("button", { name: "删除所选项目" })).toBeDisabled();
});

it("batch selection skips protected rows and respects the 100-item limit across pages", async () => {
  api.call.mockResolvedValue(
    report(
      Array.from({ length: 121 }, (_, i) => ({
        ...item,
        id: `project:${i.toString().padStart(3, "0")}`,
        name: `项目 ${i}`,
        blockedReason: i === 0 ? "正在使用" : null,
      })),
    ),
  );
  render(<StorageSettings {...props} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /临时对话/ }));
  expect(
    screen.getByRole("checkbox", { name: "选择 项目 0", exact: true }),
  ).toBeDisabled();
  await user.click(
    screen.getByRole("checkbox", { name: "选择本页可清理项目" }),
  );
  expect(screen.getByText(/已选 49 项/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "下一页" }));
  await user.click(
    screen.getByRole("checkbox", { name: "选择本页可清理项目" }),
  );
  expect(screen.getByText(/已选 99 项/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "下一页" }));
  await user.click(
    screen.getByRole("checkbox", { name: "选择本页可清理项目" }),
  );
  expect(screen.getByText(/已选 100 项/)).toBeVisible();
  expect(
    screen.getByRole("checkbox", { name: "选择本页可清理项目" }),
  ).toBeDisabled();
  expect(
    within(screen.getByRole("list", { name: "存储项目" })).getAllByRole(
      "checkbox",
      { checked: true },
    ),
  ).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "删除所选项目" }));
  expect(
    screen.getByRole("heading", { name: "永久删除所选 100 项？" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "取消" }));
  await user.click(screen.getByRole("button", { name: "清空", exact: true }));
  expect(screen.getByText("未选择项目")).toBeVisible();
});

it("returns keyboard focus and resets selection when reopening a category", async () => {
  render(<StorageSettings {...props} />);
  const user = userEvent.setup();
  const category = await screen.findByRole("button", { name: /临时对话/ });
  await user.click(category);
  expect(screen.getByRole("textbox", { name: "搜索存储项目" })).toHaveFocus();
  await user.click(screen.getByRole("checkbox", { name: "选择 临时研究" }));
  await user.click(screen.getByRole("button", { name: "完成" }));
  expect(category).toHaveFocus();
  await user.click(category);
  expect(
    screen.getByRole("checkbox", { name: "选择 临时研究" }),
  ).not.toBeChecked();
  expect(screen.getByRole("button", { name: "删除所选项目" })).toBeDisabled();
});
