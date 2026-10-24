import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ProjectTerminal } from "@/components/workspace/ProjectTerminal";
import { TooltipProvider } from "@/components/ui/tooltip";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
import { listen } from "@tauri-apps/api/event";
import { StrictMode } from "react";
import { discardTerminalSession } from "@/lib/terminalSession";
vi.mock("@/lib/terminalSession", () => ({ discardTerminalSession: vi.fn() }));
vi.mock("@/lib/api", () => ({ call: vi.fn(), desktop: true }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => vi.fn()),
}));
vi.mock("@/components/workspace/TerminalView", () => ({
  TerminalView: ({ id }: { id: string }) => (
    <div data-testid="terminal" tabIndex={0}>
      {id}
    </div>
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
  const rendered = render(view());
  await screen.findByTestId("terminal");
  const stopping = {
    ...shell,
    status: "stopping",
    updatedAt: "2026-01-01T00:00:01Z",
  };
  vi.mocked(call).mockResolvedValue(stopping);
  await user.click(screen.getByRole("button", { name: "终止终端" }));
  expect(
    await screen.findByRole("status", { name: "终止中" }),
  ).toBeInTheDocument();
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
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "终端 1", exact: true }),
    ).toBeNull(),
  );
  expect(screen.queryByTestId("terminal")).toBeNull();
  expect(screen.queryByText("已退出")).toBeNull();
  expect(call).toHaveBeenCalledTimes(2);
  // The stale launch reply must not resurrect an exited process.
  act(() => callback({ payload: shell } as never));
  expect(screen.queryByTestId("terminal")).toBeNull();
  expect(call).toHaveBeenCalledTimes(2);
  vi.mocked(call).mockResolvedValue({ ...shell, id: "shell-new" });
  rendered.rerender(view("/a", false));
  rendered.rerender(view());
  expect(await screen.findByTestId("terminal")).toHaveTextContent("shell-new");
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
  await user.click(
    screen.getByRole("button", { name: "新建终端", exact: true }),
  );
  expect(await screen.findByTestId("terminal")).toHaveTextContent("shell-b");
  expect(call).toHaveBeenLastCalledWith("project_terminal_start", {
    project: "/a",
    newSession: true,
  });
  vi.mocked(call).mockResolvedValue({ ...shell, id: "shell-c" });
  await user.click(screen.getByRole("button", { name: "拆分终端" }));
  await waitFor(() =>
    expect(screen.getAllByTestId("terminal")).toHaveLength(2),
  );
  expect(
    screen.getAllByTestId("terminal").map((node) => node.textContent),
  ).toEqual(["shell-b", "shell-c"]);
  rendered.rerender(view("/a", false));
  expect(screen.queryAllByTestId("terminal")).toHaveLength(0);
  rendered.rerender(view());
  await waitFor(() =>
    expect(screen.getAllByTestId("terminal")).toHaveLength(2),
  );
  expect(call).toHaveBeenCalledTimes(3);
  // Switching a tab selects its whole group, including the saved split.
  await user.click(screen.getByRole("button", { name: "终端 1", exact: true }));
  expect(await screen.findByTestId("terminal")).toHaveTextContent("shell-a");
  await user.click(screen.getByRole("button", { name: "终端 2", exact: true }));
  await waitFor(() =>
    expect(screen.getAllByTestId("terminal")).toHaveLength(2),
  );
  expect(
    screen.getAllByTestId("terminal").map((node) => node.textContent),
  ).toEqual(["shell-b", "shell-c"]);
  await user.click(screen.getByRole("button", { name: "终端 2", exact: true }));
  expect(screen.getAllByTestId("terminal")).toHaveLength(2);
  expect(call).toHaveBeenCalledTimes(3);
  await user.click(screen.getByRole("button", { name: "取消终端分组" }));
  expect(screen.getAllByTestId("terminal")).toHaveLength(1);
  expect(call).toHaveBeenCalledTimes(3);
});

it("removes only the exited pane and keeps independent groups intact", async () => {
  const user = userEvent.setup();
  render(view());
  await screen.findByTestId("terminal");
  vi.mocked(call).mockResolvedValue({ ...shell, id: "shell-b" });
  await user.click(screen.getByRole("button", { name: "拆分终端" }));
  await waitFor(() =>
    expect(screen.getAllByTestId("terminal")).toHaveLength(2),
  );
  vi.mocked(call).mockResolvedValue({ ...shell, id: "shell-c" });
  await user.click(
    screen.getByRole("button", { name: "新建终端", exact: true }),
  );
  const event = vi.mocked(listen).mock.calls[0][1];
  // A hidden group's first pane exits; its surviving pane must remain grouped and reachable.
  act(() =>
    event({
      payload: {
        ...shell,
        status: "completed",
        updatedAt: "2026-01-01T00:00:02Z",
      },
    } as never),
  );
  expect(screen.getByTestId("terminal")).toHaveTextContent("shell-c");
  await user.click(screen.getByRole("button", { name: "终端 1", exact: true }));
  expect(screen.getByTestId("terminal")).toHaveTextContent("shell-b");
  act(() =>
    event({
      payload: {
        ...shell,
        id: "shell-b",
        status: "completed",
        updatedAt: "2026-01-01T00:00:02Z",
      },
    } as never),
  );
  expect(
    screen.queryByRole("button", { name: "终端 1", exact: true }),
  ).toBeNull();
  expect(screen.getByTestId("terminal")).toHaveTextContent("shell-c");
  expect(call).toHaveBeenCalledTimes(3);
});

it("does not revive a shell whose exit event arrived before the launch reply", async () => {
  let resolve!: (task: unknown) => void;
  vi.mocked(call).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(view());
  await waitFor(() => expect(call).toHaveBeenCalledOnce());
  const event = vi.mocked(listen).mock.calls[0][1];
  act(() =>
    event({
      payload: {
        ...shell,
        status: "completed",
        updatedAt: "2026-01-01T00:00:02Z",
      },
    } as never),
  );
  await act(async () => resolve(shell));
  expect(screen.queryByTestId("terminal")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "终端 1", exact: true }),
  ).toBeNull();
  expect(call).toHaveBeenCalledOnce();
});

it("keeps the split target stable when changing tabs while a pane starts", async () => {
  const user = userEvent.setup();
  render(view());
  await screen.findByTestId("terminal");
  vi.mocked(call).mockResolvedValue({ ...shell, id: "shell-b" });
  await user.click(
    screen.getByRole("button", { name: "新建终端", exact: true }),
  );
  let resolve!: (task: unknown) => void;
  vi.mocked(call).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await user.click(screen.getByRole("button", { name: "拆分终端" }));
  await user.click(screen.getByRole("button", { name: "终端 1", exact: true }));
  await act(async () => resolve({ ...shell, id: "shell-c" }));
  expect(screen.getByTestId("terminal")).toHaveTextContent("shell-a");
  await user.click(screen.getByRole("button", { name: "终端 2", exact: true }));
  expect(
    screen.getAllByTestId("terminal").map((node) => node.textContent),
  ).toEqual(["shell-b", "shell-c"]);
  fireEvent.focus(screen.getAllByTestId("terminal")[0]);
  vi.mocked(call).mockResolvedValue({
    ...shell,
    id: "shell-b",
    status: "stopping",
  });
  await user.click(screen.getByRole("button", { name: "终止终端" }));
  expect(call).toHaveBeenLastCalledWith("stop_task", { id: "shell-b" });
});

it("waits for the live event subscription under StrictMode and launches only once", async () => {
  let first!: () => void, second!: () => void;
  vi.mocked(listen)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          first = () => resolve(vi.fn());
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          second = () => resolve(vi.fn());
        }),
    );
  render(<StrictMode>{view()}</StrictMode>);
  await act(async () => first());
  expect(call).not.toHaveBeenCalled();
  await act(async () => second());
  await screen.findByTestId("terminal");
  expect(call).toHaveBeenCalledOnce();
});

it("removes the focused right pane on exit and releases its renderer exactly once", async () => {
  const user = userEvent.setup();
  render(view());
  await screen.findByTestId("terminal");
  vi.mocked(call).mockResolvedValue({ ...shell, id: "shell-b" });
  await user.click(screen.getByRole("button", { name: "拆分终端" }));
  await waitFor(() =>
    expect(screen.getAllByTestId("terminal")).toHaveLength(2),
  );
  const event = vi.mocked(listen).mock.calls[0][1];
  const exited = {
    ...shell,
    id: "shell-b",
    status: "completed",
    updatedAt: "2026-01-01T00:00:02Z",
  };
  act(() => {
    event({ payload: exited } as never);
    event({ payload: exited } as never);
  });
  expect(screen.getByTestId("terminal")).toHaveTextContent("shell-a");
  await waitFor(() =>
    expect(discardTerminalSession).toHaveBeenCalledExactlyOnceWith("shell-b"),
  );
  vi.mocked(call).mockResolvedValue({ ...shell, status: "stopping" });
  await user.click(screen.getByRole("button", { name: "终止终端" }));
  expect(call).toHaveBeenLastCalledWith("stop_task", { id: "shell-a" });
});

it("retries a failed split inside its original group", async () => {
  const user = userEvent.setup();
  render(view());
  await screen.findByTestId("terminal");
  vi.mocked(call).mockRejectedValueOnce(new Error("launch failed"));
  await user.click(screen.getByRole("button", { name: "拆分终端" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("launch failed");
  expect(screen.getByTestId("terminal")).toHaveTextContent("shell-a");
  vi.mocked(call).mockResolvedValue({ ...shell, id: "shell-b" });
  await user.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() =>
    expect(screen.getAllByTestId("terminal")).toHaveLength(2),
  );
  expect(
    screen.queryByRole("button", { name: "终端 2", exact: true }),
  ).toBeNull();
});

it("runs an editor file in a new terminal group and preserves the existing shell", async () => {
  render(view());
  await screen.findByTestId("terminal");
  const done = vi.fn();
  vi.mocked(call).mockResolvedValue({
    ...shell,
    id: "file-run",
    title: "运行 main.cpp",
  });
  act(() =>
    window.dispatchEvent(
      new CustomEvent("oiagent-project-terminal", {
        detail: { type: "run", project: "/a", file: "main.cpp", done },
      }),
    ),
  );
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(call).toHaveBeenLastCalledWith("project_terminal_start", {
    project: "/a",
    newSession: true,
    file: "main.cpp",
  });
  expect(screen.getByTestId("terminal")).toHaveTextContent("file-run");
  expect(screen.getByText("运行 main.cpp")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "终端 1" }));
  expect(screen.getByTestId("terminal")).toHaveTextContent("shell-a");
});

it("does not drop an editor run requested while the initial shell is starting", async () => {
  let resolve!: (task: typeof shell) => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(view());
  await waitFor(() => expect(call).toHaveBeenCalledOnce());
  const done = vi.fn();
  act(() =>
    window.dispatchEvent(
      new CustomEvent("oiagent-project-terminal", {
        detail: { type: "run", project: "/a", file: "main.py", done },
      }),
    ),
  );
  expect(call).toHaveBeenCalledOnce();
  vi.mocked(call).mockResolvedValue({
    ...shell,
    id: "run-after-shell",
    title: "运行 main.py",
  });
  await act(async () => resolve(shell));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(call).toHaveBeenLastCalledWith("project_terminal_start", {
    project: "/a",
    newSession: true,
    file: "main.py",
  });
  expect(screen.getByTestId("terminal")).toHaveTextContent("run-after-shell");
});
