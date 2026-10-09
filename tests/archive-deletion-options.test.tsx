import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import {
  ArchiveSelection,
  ArchiveCheckbox,
  ArchiveToolbar,
} from "@/components/workspace/ArchiveSelection";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({ desktop: true, call: vi.fn() }));
const task = {
  ...demoSnapshot.tasks[0],
  id: "archived-one",
  archived: true,
  status: "completed" as const,
};
const files = [
  {
    kind: "history",
    path: "/fixture/.claude/projects/one.jsonl",
    revision: "history-v1",
    blockedReason: null,
  },
  {
    kind: "project",
    path: "/fixture/project",
    revision: "project-v1",
    blockedReason: null,
  },
];
beforeEach(() => {
  vi.mocked(call).mockReset();
  vi.mocked(call).mockImplementation(async (command) => {
    if (command === "preview_archived_deletion") return files;
    if (command === "delete_archived_tasks")
      return { ids: [task.id], cleanupWarnings: [], deletedProjects: [] };
    throw new Error(command);
  });
});
function setup() {
  render(
    <ArchiveSelection enabled scope="archive" tasks={[task]} openProjects={[]}>
      <ArchiveToolbar />
      <ArchiveCheckbox task={task} />
    </ArchiveSelection>,
  );
  return userEvent.setup();
}
async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("checkbox", { name: `选择会话：${task.title}` }),
  );
  await user.click(screen.getByRole("button", { name: "删除所选" }));
  const dialog = screen.getByRole("dialog");
  await waitFor(() =>
    expect(
      within(dialog).getByRole("switch", { name: "保留项目文件" }),
    ).toBeEnabled(),
  );
  return dialog;
}
it("defaults to keeping both resources and passes only explicitly confirmed file targets", async () => {
  const user = setup();
  const dialog = await open(user);
  expect(
    within(dialog).getByRole("switch", { name: "保留项目文件" }),
  ).toBeChecked();
  expect(
    within(dialog).getByRole("switch", { name: "保留 Agent 原始历史" }),
  ).toBeChecked();
  await user.click(
    within(dialog).getByRole("switch", { name: "保留 Agent 原始历史" }),
  );
  expect(within(dialog).getByText(files[0].path)).toBeVisible();
  expect(within(dialog).queryByText(files[1].path)).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "确认删除" }));
  expect(call).toHaveBeenCalledWith(
    "delete_archived_tasks",
    expect.objectContaining({
      options: { keepProjectFiles: true, keepAgentHistory: false },
      confirmedFiles: [files[0]],
    }),
  );
});
it("blocks removing a shared project and resets switches when the dialog reopens", async () => {
  vi.mocked(call).mockResolvedValue(
    files.map((f) =>
      f.kind === "project"
        ? { ...f, blockedReason: "仍被其他会话使用，请保留项目文件" }
        : f,
    ),
  );
  const user = setup();
  let dialog = await open(user);
  await user.click(
    within(dialog).getByRole("switch", { name: "保留项目文件" }),
  );
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "仍被其他会话使用",
  );
  expect(
    within(dialog).getByRole("button", { name: "确认删除" }),
  ).toBeDisabled();
  await user.click(within(dialog).getByRole("button", { name: "取消" }));
  await user.click(screen.getByRole("button", { name: "删除所选" }));
  dialog = screen.getByRole("dialog");
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: "确认删除" }),
    ).toBeEnabled(),
  );
  expect(
    within(dialog).getByRole("switch", { name: "保留项目文件" }),
  ).toBeChecked();
});
