import { act, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { FileBreadcrumbs } from "@/components/workspace/FileBreadcrumbs";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({ call: vi.fn() }));
beforeEach(() => vi.mocked(call).mockReset());
const entry = (name: string, directory = false, base = "src") => ({
  name,
  path: base ? `${base}/${name}` : name,
  directory,
  symlink: false,
});
it("loads only an opened level, browses siblings and directories, and opens the selected file", async () => {
  vi.mocked(call).mockImplementation(async (_, args) => ({
    entries:
      args?.path === "src/nested"
        ? [entry("child.ts", false, "src/nested")]
        : [entry("main.ts"), entry("other.ts"), entry("nested", true)],
    next: null,
  }));
  const onOpen = vi.fn(),
    user = userEvent.setup();
  render(
    <FileBreadcrumbs project="/repo" path="src/main.ts" onOpen={onOpen} />,
  );
  expect(call).not.toHaveBeenCalled();
  const nav = screen.getByRole("navigation", { name: "文件路径" });
  await user.click(within(nav).getByRole("button", { name: "main.ts" }));
  const picker = screen.getByRole("dialog", { name: "浏览 main.ts" });
  expect(
    await within(picker).findByRole("button", { name: "other.ts" }),
  ).toBeVisible();
  expect(call).toHaveBeenCalledWith("browse_project_directory", {
    project: "/repo",
    path: "src",
    query: "",
    after: null,
  });
  expect(screen.getByRole("textbox", { name: "筛选当前目录" })).toHaveFocus();
  await user.click(within(picker).getByRole("button", { name: "nested" }));
  await user.click(
    await within(picker).findByRole("button", { name: "child.ts" }),
  );
  expect(onOpen).toHaveBeenCalledWith("src/nested/child.ts");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(within(nav).getByRole("button", { name: "main.ts" })).toHaveFocus();
});
it("replaces pages instead of accumulating rows and searches the directory on the server", async () => {
  vi.mocked(call).mockImplementation(async (_, args) => ({
    entries: args?.query
      ? [entry("match.ts")]
      : Array.from({ length: 80 }, (_, i) =>
          entry(`file-${args?.after ? 80 + i : i}.ts`),
        ),
    next: args?.after || args?.query ? null : "cursor",
  }));
  const user = userEvent.setup();
  render(
    <FileBreadcrumbs project="/repo" path="src/main.ts" onOpen={vi.fn()} />,
  );
  await user.click(screen.getByRole("button", { name: "main.ts" }));
  await screen.findByRole("button", { name: "file-0.ts" });
  await user.click(screen.getByRole("button", { name: "下一页" }));
  await screen.findByRole("button", { name: "file-80.ts" });
  expect(
    screen.queryByRole("button", { name: "file-0.ts" }),
  ).not.toBeInTheDocument();
  expect(
    screen
      .getByLabelText("目录内容")
      .querySelectorAll("[data-directory-entry]"),
  ).toHaveLength(80);
  await user.type(screen.getByRole("textbox"), "match");
  await screen.findByRole("button", { name: "match.ts" });
  expect(call).toHaveBeenLastCalledWith("browse_project_directory", {
    project: "/repo",
    path: "src",
    query: "match",
    after: null,
  });
});
it("ignores late responses from an old level, retries failures and preserves keyboard navigation", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(call)
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockRejectedValueOnce(new Error("permission denied"))
    .mockResolvedValue({ entries: [entry("ok.ts", false, "")], next: null });
  const user = userEvent.setup(),
    onOpen = vi.fn();
  render(
    <FileBreadcrumbs project="/repo" path="src/main.ts" onOpen={onOpen} />,
  );
  await user.click(screen.getByRole("button", { name: "main.ts" }));
  await waitFor(() => expect(resolve).toBeDefined());
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "repo" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "permission denied",
  );
  await act(async () => resolve({ entries: [entry("stale.ts")], next: null }));
  expect(screen.queryByText("stale.ts")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "刷新目录" }));
  await screen.findByRole("button", { name: "ok.ts" });
  screen.getByRole("textbox").focus();
  await user.keyboard("{ArrowDown}{Enter}");
  expect(onOpen).toHaveBeenCalledWith("ok.ts");
});
