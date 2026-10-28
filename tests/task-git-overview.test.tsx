import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TaskGitOverview } from "@/components/workspace/TaskGitOverview";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({ desktop: true, call: vi.fn() }));

it("opens a Git diff, including the original path for a renamed file", async () => {
  vi.mocked(call).mockResolvedValue({ git: true, files: [
    { path: "new.ts", originalPath: "old.ts", status: "R ", taskTouched: true },
    ...Array.from({ length: 4 }, (_, i) => ({ path: `${i}.ts`, status: "??", taskTouched: false })),
  ], truncated: false });
  const onOpenFile = vi.fn();
  render(<TaskGitOverview project="/repo" taskId="task" status="completed" revision={1} onOpenFile={onOpenFile} />);
  fireEvent.click(await screen.findByRole("button", { name: "查看 Git 改动：new.ts" }));
  expect(onOpenFile).toHaveBeenCalledWith("/repo", "new.ts", "diff", "old.ts");
  expect(screen.queryByRole("button", { name: "查看 Git 改动：3.ts" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "展开 1 个文件" }));
  expect(screen.getByRole("button", { name: "查看 Git 改动：3.ts" })).toBeVisible();
  expect(call).toHaveBeenCalledWith("project_changes", { project: "/repo", taskId: "task" });
});

it("ignores a late response from the previous project and hides Git for a non-repository", async () => {
  let resolveOld!: (value: unknown) => void;
  vi.mocked(call).mockImplementation((_, args) => args?.project === "/old"
    ? new Promise((resolve) => { resolveOld = resolve; })
    : Promise.resolve({ git: false, files: [], truncated: false }));
  const view = render(<TaskGitOverview project="/old" taskId="old" status="completed" revision={0} />);
  await waitFor(() => expect(resolveOld).toBeDefined());
  view.rerender(<TaskGitOverview project="/new" taskId="new" status="completed" revision={0} />);
  await waitFor(() => expect(screen.queryByRole("region", { name: "Git 改动" })).not.toBeInTheDocument());
  await act(async () => resolveOld({ git: true, files: [{ path: "stale.ts", status: "M" }] }));
  expect(screen.queryByText("stale.ts")).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Git 改动" })).not.toBeInTheDocument();
});
