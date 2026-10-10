import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { extensionBridge } from "@/lib/extensions/bridge";
import { validateUi, uiValues, type UiNode } from "@/lib/extensions/ui";
import { ExtensionUi } from "@/components/extensions/ExtensionUi";
import { demoSnapshot } from "@/lib/demo";
import type {
  ExtensionManifest,
  ExtensionPackage,
} from "@/lib/extensions/types";
import manifest from "../examples/plugins/project-notes/oiagent.plugin.json";
const plugin = (): ExtensionPackage => ({
  manifest: structuredClone(manifest) as ExtensionManifest,
  enabled: true,
  revision: "1",
  settings: {},
  source: "",
  storage: {},
});
const host = () => ({
  context: () => ({ project: "/repo", taskId: "task" }),
  tasks: () => demoSnapshot.tasks,
  save: vi.fn(async () => {}),
  open: vi.fn(),
  draft: vi.fn(),
  notify: vi.fn(),
});
it("limits requests to declared capabilities and never exposes task prompts or launch secrets", async () => {
  const p = plugin(),
    h = host(),
    request = extensionBridge(p, h);
  expect(await request("workspace.context", null)).toEqual({
    project: "/repo",
    taskId: "task",
  });
  await expect(request("tasks.list", null)).rejects.toThrow("权限");
  await expect(request("invoke", { command: "create_task" })).rejects.toThrow(
    "不支持",
  );
  await expect(request("views.open", { id: "other-plugin" })).rejects.toThrow(
    "未在",
  );
  p.manifest.permissions.push("tasks.read");
  const tasks = (await request("tasks.list", null)) as object[];
  expect(tasks[0]).toHaveProperty("status");
  expect(tasks[0]).not.toHaveProperty("prompt");
  expect(tasks[0]).not.toHaveProperty("env");
  await request("tasks.draft", {
    prompt: "Review changes",
    title: "Review",
    command: "sh",
    env: { KEY: "secret" },
  });
  expect(h.draft).toHaveBeenCalledWith({
    prompt: "Review changes",
    title: "Review",
  });
  await expect(request("tasks.draft", { prompt: "" })).rejects.toThrow("无效");
});
it("serializes plugin writes and preserves previous data after a failed save", async () => {
  const h = host();
  const request = extensionBridge(plugin(), h);
  await request("storage.set", { note: "first" });
  h.save.mockRejectedValueOnce(new Error("disk full"));
  await expect(request("storage.set", { note: "lost" })).rejects.toThrow(
    "disk full",
  );
  expect(await request("storage.get", null)).toEqual({ note: "first" });
  await Promise.all([
    request("storage.set", { note: "second" }),
    request("storage.set", { note: "third" }),
  ]);
  expect(await request("storage.get", null)).toEqual({ note: "third" });
  await expect(
    request("storage.set", { huge: "x".repeat(140000) }),
  ).rejects.toThrow("128 KB");
});
it("rejects malformed, excessive and unsafe UI trees", () => {
  expect(() =>
    validateUi({ type: "html", text: "<script>alert(1)</script>" }),
  ).toThrow();
  expect(() =>
    validateUi({ type: "table", columns: ["A"], rows: [["B", "C"]] }),
  ).toThrow();
  expect(() =>
    validateUi({
      type: "stack",
      children: Array.from({ length: 401 }, () => ({ type: "text" })),
    }),
  ).toThrow();
  expect(() =>
    validateUi({
      type: "select",
      id: "mode",
      label: "Mode",
      options: [{ value: "", label: "Empty" }],
    }),
  ).toThrow();
  let nested: UiNode = { type: "text" };
  for (let i = 0; i < 14; i++) nested = { type: "stack", children: [nested] };
  expect(() => validateUi(nested)).toThrow();
  expect(() => validateUi({ type: "stack", children: [1, 2] })).toThrow();
});
it("renders host controls, treats markup as text and retains default form values for actions", async () => {
  const user = userEvent.setup(),
    change = vi.fn(),
    action = vi.fn();
  const tree = validateUi({
    type: "stack",
    children: [
      { type: "text", text: "<script>not executable</script>" },
      { type: "input", id: "title", label: "标题", value: "Saved" },
      { type: "textarea", id: "notes", label: "内容", value: "Note" },
      { type: "button", text: "保存", action: "save" },
    ],
  });
  render(
    <ExtensionUi node={tree} values={{}} onChange={change} onAction={action} />,
  );
  expect(screen.getByText("<script>not executable</script>")).toBeVisible();
  expect(document.querySelector("script")).toBeNull();
  expect(screen.getByLabelText("标题")).toHaveValue("Saved");
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(action).toHaveBeenCalledWith("save");
  expect(uiValues(tree)).toEqual({ title: "Saved", notes: "Note" });
});
