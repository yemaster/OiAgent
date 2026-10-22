import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ProjectTerminal } from "@/components/workspace/ProjectTerminal";
import { TooltipProvider } from "@/components/ui/tooltip";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
import { listen } from "@tauri-apps/api/event";
vi.mock("@/lib/api", () => ({ call: vi.fn(), desktop: true }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => vi.fn()),
}));
vi.mock("@/components/workspace/TerminalView", () => ({
  TerminalView: ({ id }: { id: string }) => (
    <div data-testid="terminal">{id}</div>
  ),
}));
const shell = {
  ...demoSnapshot.tasks[0],
  id: "shell-a",
  project: "/a",
  agentKind: "project-shell",
  source: "terminal",
  status: "running",
  updatedAt: "2026-01-01T00:00:00Z",
};
function view(project = "/a", open = true) {
  return (
    <TooltipProvider>
      <ProjectTerminal project={project} open={open} onClose={vi.fn()}>
        <input aria-label="editor" defaultValue="draft" />
      </ProjectTerminal>
    </TooltipProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(call).mockResolvedValue(shell);
});
it("hides without stopping or recreating the shell or editor", async () => {
  const rendered = render(view());
  await screen.findByTestId("terminal");
  const editor = screen.getByLabelText("editor");
  fireEvent.change(editor, { target: { value: "draft retained" } });
  rendered.rerender(view("/a", false));
  expect(screen.queryByTestId("terminal")).toBeNull();
  expect(screen.getByLabelText("editor")).toBe(editor);
  expect(editor).toHaveValue("draft retained");
  rendered.rerender(view());
  expect(await screen.findByTestId("terminal")).toHaveTextContent("shell-a");
  expect(call).toHaveBeenCalledTimes(1);
});
it("keeps terminal ownership when switching projects during launch", async () => {
  let complete!: (value: unknown) => void;
  vi.mocked(call).mockImplementation(async (_, args) =>
    args?.project === "/a"
      ? new Promise((resolve) => {
          complete = resolve;
        })
      : { ...shell, id: "shell-b", project: "/b" },
  );
  const rendered = render(view());
  rendered.rerender(view("/b"));
  expect(await screen.findByTestId("terminal")).toHaveTextContent("shell-b");
  await act(async () => complete(shell));
  expect(screen.getByTestId("terminal")).toHaveTextContent("shell-b");
  rendered.rerender(view());
  expect(await screen.findByTestId("terminal")).toHaveTextContent("shell-a");
});
it("does not restart an exited shell and keeps stopping until exit confirmation", async () => {
  const user = userEvent.setup();
  render(view());
  await screen.findByTestId("terminal");
  const stopping = {
    ...shell,
    status: "stopping",
    updatedAt: "2026-01-01T00:00:01Z",
  };
  vi.mocked(call).mockResolvedValue(stopping);
  await user.click(screen.getByRole("button", { name: "终止终端" }));
  expect(await screen.findByText("终止中…")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "重新打开终端" })).toBeNull();
  const callback = vi.mocked(listen).mock.calls[0][1];
  act(() =>
    callback({
      payload: {
        ...stopping,
        status: "cancelled",
        updatedAt: "2026-01-01T00:00:02Z",
      },
    } as never),
  );
  await waitFor(() => expect(screen.getByText("已退出")).toBeInTheDocument());
  expect(call).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "重新打开终端" })).toBeEnabled();
});
it("keeps a launch failure visible without repeatedly starting shells", async () => {
  vi.mocked(call).mockRejectedValue(new Error("missing directory"));
  render(view());
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "missing directory",
  );
  expect(call).toHaveBeenCalledTimes(1);
});

it("creates independent sessions, splits them and preserves both when the panel hides", async () => {
  const user = userEvent.setup();
  const rendered = render(view());
  await screen.findByTestId("terminal");
  vi.mocked(call).mockResolvedValue({ ...shell, id: "shell-b" });
  await user.click(screen.getByRole("button", { name: "新建终端", exact: true }));
  expect(await screen.findByTestId("terminal")).toHaveTextContent("shell-b");
  expect(call).toHaveBeenLastCalledWith("project_terminal_start", { project: "/a", newSession: true });
  vi.mocked(call).mockResolvedValue({ ...shell, id: "shell-c" });
  await user.click(screen.getByRole("button", { name: "拆分终端" }));
  await waitFor(() => expect(screen.getAllByTestId("terminal")).toHaveLength(2));
  expect(screen.getAllByTestId("terminal").map((node) => node.textContent)).toEqual(["shell-b", "shell-c"]);
  rendered.rerender(view("/a", false));
  expect(screen.queryAllByTestId("terminal")).toHaveLength(0);
  rendered.rerender(view());
  await waitFor(() => expect(screen.getAllByTestId("terminal")).toHaveLength(2));
  expect(call).toHaveBeenCalledTimes(3);
  await user.click(screen.getByRole("button", { name: "收起终端分栏" }));
  await user.click(screen.getByRole("button", { name: "终端 1", exact: true }));
  expect(await screen.findByTestId("terminal")).toHaveTextContent("shell-a");
  expect(call).toHaveBeenCalledTimes(3);
});
