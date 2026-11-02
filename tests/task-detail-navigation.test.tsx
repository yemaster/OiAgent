import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DetailPage } from "@/pages/Detail";
import { TooltipProvider } from "@/components/ui/tooltip";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({ desktop: true, call: vi.fn() }));
vi.mock("@/components/workspace/StepChangePreview", () => ({
  default: ({ change }: { change: { after: string } }) => (
    <div>{change.after}</div>
  ),
}));
afterEach(() => vi.restoreAllMocks());

function setup() {
  const task = {
    ...demoSnapshot.tasks[0],
    id: "detail-navigation",
    status: "completed",
    source: "managed",
  };
  const messages = ["a.ts", "b.ts"].map((path) => ({
    role: "tool",
    text: "",
    timestamp: "",
    tool: {
      callId: path,
      name: "Edit",
      state: "completed",
      input: {
        file_path: path,
        old_string: "before",
        new_string: `diff of ${path}`,
      },
      output: "done",
    },
  }));
  vi.mocked(call).mockImplementation(async (name) => {
    if (name === "get_detail") return { task, messages, log: "task log" };
    if (name === "task_changes")
      return { messages, total: 2, next: null, omitted: false };
    if (name === "project_changes")
      return {
        git: true,
        files: [{ path: "git-file.ts", status: " M" }],
        truncated: false,
      };
    if (name === "task_artifacts")
      return {
        files: [
          {
            path: `${task.project}/report.md`,
            project: task.project,
            relativePath: "report.md",
            stepIds: [],
            size: 10,
            error: null,
          },
        ],
        truncated: false,
      };
    if (name === "task_artifact")
      return { content: "# 保留产物预览", revision: "1", truncated: false };
    return [];
  });
  render(
    <TooltipProvider>
      <DetailPage
        task={task}
        tasks={[]}
        agents={demoSnapshot.agents}
        profiles={[]}
        onBack={vi.fn()}
        onRetry={vi.fn()}
        onOpen={vi.fn()}
        onChanged={vi.fn()}
      />
    </TooltipProvider>,
  );
  return userEvent.setup();
}

it("opens sidebar changes in the existing task details with the selected diff and stable sizing across pages", async () => {
  const user = setup();
  await user.click(
    screen.getByRole("button", { name: "任务进展", exact: true }),
  );
  const card = screen.getByRole("complementary", { name: "任务进展" });
  await user.click(await within(card).findByTitle("b.ts"));
  const dialog = screen.getByRole("dialog", { name: "任务信息" });
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(within(dialog).getByRole("tab", { name: "改动" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(await within(dialog).findByText("diff of b.ts")).toBeVisible();
  expect(within(dialog).queryByText("diff of a.ts")).not.toBeInTheDocument();
  const sizing = dialog.className;
  for (const tab of ["信息", "进程和服务", "原始日志", "产物", "改动"]) {
    await user.click(
      within(dialog).getByRole("tab", { name: tab, exact: true }),
    );
    expect(dialog.className).toBe(sizing);
    expect(
      within(dialog).getByRole("tab", { name: tab, exact: true }),
    ).toHaveAttribute("aria-selected", "true");
  }
  await user.keyboard("{Escape}");
  await user.click(
    screen.getByRole("button", { name: "任务信息", exact: true }),
  );
  const reopened = screen.getByRole("dialog", { name: "任务信息" });
  expect(reopened.className).toBe(sizing);
  expect(within(reopened).getByRole("tab", { name: "信息" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

it.each(["改动", "产物"])(
  "keeps %s content until the closing sheet animation finishes",
  async (tab) => {
    // JSDOM has no animation clock; expose the live CSS animation names that Radix observes.
    const computedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element, pseudo) => {
        const style = computedStyle(element, pseudo);
        if (
          !element.matches(
            '[data-slot="sheet-content"], [data-slot="sheet-overlay"]',
          )
        )
          return style;
        return new Proxy(style, {
          get(target, key) {
            if (key === "animationName")
              return element.getAttribute("data-state") === "closed"
                ? "exit"
                : "enter";
            return Reflect.get(target, key, target);
          },
        });
      },
    );
    const user = setup();
    await user.click(
      screen.getByRole("button", { name: "任务信息", exact: true }),
    );
    const dialog = screen.getByRole("dialog", { name: "任务信息" });
    await user.click(
      within(dialog).getByRole("tab", { name: tab, exact: true }),
    );
    const content = tab === "改动" ? "共 2 次修改 · 最近记录" : "保留产物预览";
    await within(dialog).findByText(content);
    const sizing = dialog.className;
    await user.click(
      within(dialog).getByRole("button", { name: "Close", exact: true }),
    );
    expect(dialog).toHaveAttribute("data-state", "closed");
    expect(dialog).toBeInTheDocument();
    expect(dialog.className).toBe(sizing);
    expect(within(dialog).getByText(content)).toBeInTheDocument();
    if (tab === "产物")
      expect(within(dialog).queryByText("暂无产物")).not.toBeInTheDocument();
    for (const element of document.querySelectorAll(
      '[data-slot="sheet-content"], [data-slot="sheet-overlay"]',
    )) {
      const event = new Event("animationend", { bubbles: true });
      Object.defineProperty(event, "animationName", { value: "exit" });
      fireEvent(element, event);
    }
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  },
);

it("routes Git review to the same changes page and allows returning to session changes", async () => {
  const user = setup();
  await user.click(
    screen.getByRole("button", { name: "任务进展", exact: true }),
  );
  const card = screen.getByRole("complementary", { name: "任务进展" });
  await waitFor(() =>
    expect(within(card).getByText("git-file.ts")).toBeVisible(),
  );
  await user.click(within(card).getByRole("button", { name: "查看 Git 详情" }));
  const dialog = screen.getByRole("dialog", { name: "任务信息" });
  expect(within(dialog).getByRole("tab", { name: "改动" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const scope = within(dialog).getByRole("combobox", { name: "改动范围" });
  expect(scope).toHaveTextContent("Git 未提交改动");
  expect(await within(dialog).findByText("git-file.ts")).toBeVisible();
  await user.click(scope);
  await user.click(screen.getByRole("option", { name: "会话改动" }));
  expect(await within(dialog).findByText("diff of a.ts")).toBeVisible();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
});
