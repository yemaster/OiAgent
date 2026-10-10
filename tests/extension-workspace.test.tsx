import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import App from "@/App";
import manifest from "../examples/plugins/project-notes/oiagent.plugin.json";
import source from "../examples/plugins/project-notes/main.js?raw";
vi.mock("@/lib/api", async (importOriginal) => {
  const api = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...api,
    call: async (command: string, args?: Record<string, unknown>) => {
      const plugin = { manifest, enabled: true, revision: "one", settings: {} };
      if (command === "extension_catalog")
        return { items: [plugin], warnings: [] };
      if (command === "load_extension")
        return { ...plugin, source, storage: {} };
      return api.call(command, args);
    },
  };
});
class MockWorker {
  static instances: MockWorker[] = [];
  onmessage?: (event: MessageEvent) => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    MockWorker.instances.push(this);
  }
  send(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}
beforeEach(() => {
  localStorage.setItem("oiagent-onboarded", "true");
  MockWorker.instances = [];
  vi.stubGlobal("Worker", MockWorker);
  URL.createObjectURL = vi.fn(() => "blob:plugin");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
});
async function openNotes() {
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "当前任务" });
  expect(MockWorker.instances).toHaveLength(0);
  await user.click(
    await screen.findByRole("button", { name: "项目便笺 · 项目便笺" }),
  );
  await screen.findByRole("heading", { name: "项目便笺" });
  await waitFor(() => expect(MockWorker.instances).toHaveLength(1));
  return user;
}
it("opens contributed tabs lazily, suspends on navigation and restores form drafts and close history", async () => {
  render(<App />);
  const user = await openNotes();
  const first = MockWorker.instances[0];
  act(() =>
    first.send({
      type: "render",
      tree: { type: "input", id: "note", label: "便笺", value: "" },
    }),
  );
  await user.type(
    await screen.findByRole("textbox", { name: "便笺" }),
    "draft",
  );
  await user.click(screen.getByRole("tab", { name: "当前页面：当前任务" }));
  expect(first.terminate).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("tab", { name: "项目便笺" }));
  await waitFor(() => expect(MockWorker.instances).toHaveLength(2));
  const second = MockWorker.instances[1];
  expect(second.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "open",
      payload: expect.objectContaining({ values: { note: "draft" } }),
    }),
  );
  await user.click(screen.getByRole("button", { name: "关闭标签：项目便笺" }));
  await screen.findByRole("heading", { name: "当前任务" });
  expect(second.terminate).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole("tab", { name: "项目便笺" }),
  ).not.toBeInTheDocument();
});
it("shows plugin commands in search and creates a draft without starting an agent", async () => {
  render(<App />);
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "项目便笺 · 项目便笺" });
  await user.keyboard("{Control>}k{/Control}");
  const dialog = await screen.findByRole("dialog", { name: /搜索工作区/ });
  await user.type(within(dialog).getByRole("textbox"), "打开项目便笺");
  await user.click(
    within(dialog).getByRole("button", { name: /打开项目便笺/ }),
  );
  await waitFor(() => expect(MockWorker.instances).toHaveLength(1));
  await act(async () =>
    MockWorker.instances[0].send({
      type: "request",
      id: 1,
      method: "tasks.draft",
      params: { title: "Review", prompt: "Review current changes" },
    }),
  );
  await screen.findByRole("heading", { name: "新建任务" });
  expect(document.getElementById("task-prompt")).toHaveValue(
    "Review current changes",
  );
  expect(screen.getByRole("tab", { name: "项目便笺" })).toBeVisible();
});
