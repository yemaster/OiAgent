import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TaskGitOverview } from "@/components/workspace/TaskGitOverview";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({ desktop: true, call: vi.fn() }));

it("opens a Git diff, including the original path for a renamed file", async () => {
  vi.mocked(call).mockResolvedValue({
    git: true,
    files: [
      {
        path: "new.ts",
        originalPath: "old.ts",
        status: "R ",
        taskTouched: true,
        lineStats: { additions: 12, deletions: 3 },
      },
      ...Array.from({ length: 4 }, (_, i) => ({
        path: `${i}.ts`,
        status: "??",
        taskTouched: false,
      })),
    ],
    truncated: false,
  });
  const onOpenFile = vi.fn();
  render(
    <TaskGitOverview
      project="/repo"
      taskId="task"
      status="completed"
      revision={1}
      onOpenFile={onOpenFile}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "查看 Git 改动：new.ts" }),
  );
  expect(onOpenFile).toHaveBeenCalledWith("/repo", "new.ts", "diff", "old.ts");
  expect(screen.getByText("+12")).toBeVisible();
  expect(screen.getByText("-3")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "查看 Git 改动：3.ts" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "展开 1 个文件" }));
  expect(
    screen.getByRole("button", { name: "查看 Git 改动：3.ts" }),
  ).toBeVisible();
  expect(call).toHaveBeenCalledWith("project_changes", {
    project: "/repo",
    taskId: "task",
    statsLimit: 4,
  });
});

it("ignores a late response from the previous project and shows an empty state for a non-repository", async () => {
  let resolveOld!: (value: unknown) => void;
  vi.mocked(call).mockImplementation((_, args) =>
    args?.project === "/old"
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : Promise.resolve({ git: false, files: [], truncated: false }),
  );
  const view = render(
    <TaskGitOverview
      project="/old"
      taskId="old"
      status="completed"
      revision={0}
    />,
  );
  await waitFor(() => expect(resolveOld).toBeDefined());
  view.rerender(
    <TaskGitOverview
      project="/new"
      taskId="new"
      status="completed"
      revision={0}
    />,
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Git 改动" }),
    ).not.toBeInTheDocument(),
  );
  await act(async () =>
    resolveOld({ git: true, files: [{ path: "stale.ts", status: "M" }] }),
  );
  expect(screen.queryByText("stale.ts")).not.toBeInTheDocument();
  expect(screen.getByText("此目录未使用 Git")).toBeVisible();
  expect(
    screen.queryByRole("region", { name: "Git 改动" }),
  ).not.toBeInTheDocument();
});

it("refreshes compact Git previews serially and stops polling when closed", async () => {
  vi.useFakeTimers();
  vi.mocked(call).mockClear();
  let resolve!: (value: unknown) => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = render(
    <TaskGitOverview
      project="/repo"
      taskId="task"
      status="running"
      revision={0}
      onDetails={vi.fn()}
    />,
  );
  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(call).toHaveBeenCalledTimes(1);
    await act(async () =>
      resolve({
        git: true,
        files: [{ path: "live.ts", status: " M" }],
        truncated: false,
      }),
    );
    expect(screen.getByText("live.ts")).toBeVisible();
    vi.mocked(call).mockResolvedValue({
      git: true,
      files: [],
      truncated: false,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(call).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("live.ts")).not.toBeInTheDocument();
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(call).toHaveBeenCalledTimes(2);
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});
