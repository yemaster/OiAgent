import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { PluginsPage } from "@/pages/Plugins";
import { call, pickDirectory } from "@/lib/api";
import type { Extension, ExtensionManifest } from "@/lib/extensions/types";
import manifest from "../examples/plugins/project-notes/oiagent.plugin.json";
vi.mock("@/lib/api", () => ({
  desktop: true,
  call: vi.fn(),
  pickDirectory: vi.fn(),
}));
const plugin = (): Extension => ({
  manifest: structuredClone(manifest) as ExtensionManifest,
  enabled: false,
  revision: "hash",
  settings: {},
});
const props = () => ({
  items: [plugin()],
  warnings: [],
  error: "",
  onRefresh: vi.fn(async () => {}),
  onOpen: vi.fn(),
  onAgents: vi.fn(),
});
beforeEach(() => vi.clearAllMocks());
it("reviews local package permissions on a page before installation and does not run it", async () => {
  const p = props(),
    user = userEvent.setup();
  vi.mocked(pickDirectory).mockResolvedValue("/plugin");
  vi.mocked(call).mockImplementation(async (command) => {
    if (command === "inspect_extension") return plugin();
    return undefined;
  });
  render(<PluginsPage {...p} />);
  await user.click(screen.getByRole("button", { name: "从目录安装" }));
  expect(
    await screen.findByRole("heading", { name: "更新插件" }),
  ).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByText("读取当前项目路径和任务 ID")).toBeVisible();
  expect(call).not.toHaveBeenCalledWith("install_extension", expect.anything());
  await user.click(screen.getByRole("button", { name: "确认安装" }));
  await waitFor(() => expect(p.onRefresh).toHaveBeenCalledOnce());
  expect(call).toHaveBeenCalledWith("install_extension", {
    path: "/plugin",
    revision: "hash",
  });
  expect(call).not.toHaveBeenCalledWith("load_extension", expect.anything());
});
it("enables and configures plugins independently from opening a view", async () => {
  const p = props(),
    user = userEvent.setup();
  const view = render(
    <PluginsPage {...p} initialSelection={p.items[0].manifest.id} />,
  );
  const open = screen.getByRole("button", { name: "项目便笺", exact: true });
  expect(open).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "启用", exact: true }));
  expect(call).toHaveBeenCalledWith("configure_extension", {
    id: p.items[0].manifest.id,
    enabled: true,
    settings: {},
  });
  await waitFor(() => expect(p.onRefresh).toHaveBeenCalled());
  expect(p.onOpen).not.toHaveBeenCalled();
  view.rerender(
    <PluginsPage
      {...p}
      items={[{ ...p.items[0], enabled: true }]}
      initialSelection={p.items[0].manifest.id}
    />,
  );
  await user.type(screen.getByLabelText("任务标题前缀"), "Review: ");
  await user.click(screen.getByRole("button", { name: "保存设置" }));
  expect(call).toHaveBeenLastCalledWith("configure_extension", {
    id: p.items[0].manifest.id,
    enabled: true,
    settings: { "task-prefix": "Review: " },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "项目便笺", exact: true }),
    ).toBeEnabled(),
  );
  await user.click(
    screen.getByRole("button", { name: "项目便笺", exact: true }),
  );
  expect(p.onOpen).toHaveBeenCalledWith(p.items[0].manifest.id, "notes");
});
