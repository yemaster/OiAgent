import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import App from "@/App";
import { call, pickDirectory } from "@/lib/api";
import { demoSnapshot, demoDetail } from "@/lib/demo";
import type { OpenFile } from "@/lib/files";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  desktop: true,
  call: vi.fn(),
  pickDirectory: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: async () => () => {} }),
}));
// Exercise real workspace navigation and file lifecycle without loading Monaco.
vi.mock("@/pages/FileEditor", () => ({
  FileEditor: ({
    file,
    onChange,
  }: {
    file: OpenFile;
    onChange: (text: string) => void;
  }) => (
    <textarea
      aria-label="Skill 编辑内容"
      value={file.content}
      disabled={file.loading}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
const initialContent =
  "---\nname: review\ndescription: Review changes\n---\nReview.";
let disk: { content: string; revision: string };
const project = "/picked/custom-project";
const taskTitle = "检查 API 错误处理与重试逻辑";
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("oiagent-onboarded", "true");
  disk = { content: initialContent, revision: "original" };
  vi.mocked(pickDirectory).mockResolvedValue(project);
  vi.mocked(call).mockReset();
  vi.mocked(call).mockImplementation(async (command, args) => {
    if (command === "get_snapshot") return structuredClone(demoSnapshot);
    if (command === "lan_remote_snapshots") return [];
    if (command === "get_detail")
      return demoDetail(
        demoSnapshot.tasks.find((task) => task.id === args?.id)!,
      );
    if (command === "integration_view")
      return {
        configPath: "config",
        skillsPath: `${project}/.claude/skills`,
        revision: "r",
        servers: [],
        warnings: [],
        skills: [
          {
            id: "0:review",
            name: "review",
            description: "Review changes",
            path: `${project}/.claude/skills/review/SKILL.md`,
            ...disk,
          },
        ],
      };
    if (command === "read_project_file") return { ...disk };
    if (command === "integration_save_skill") {
      disk = { content: String(args?.content), revision: "saved" };
      return { ...disk };
    }
    throw new Error(`Unexpected mock command: ${command}`);
  });
});
async function openSkill() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "当前任务" });
  await user.click(screen.getByRole("button", { name: new RegExp(taskTitle) }));
  await screen.findByRole("heading", { name: taskTitle });
  await user.click(
    within(screen.getByRole("navigation", { name: "工具栏" })).getByRole(
      "button",
      { name: "Agent 程序", exact: true },
    ),
  );
  await user.click(
    within(screen.getByRole("complementary", { name: "侧边导航" })).getByRole(
      "button",
      { name: "MCP 与 Skills" },
    ),
  );
  await screen.findByRole("heading", { name: "MCP 与 Skills" });
  await user.click(screen.getByRole("combobox", { name: "配置 Agent" }));
  await user.click(screen.getByRole("option", { name: "Claude Code" }));
  await user.click(screen.getByRole("button", { name: "选择项目" }));
  await user.click(await screen.findByRole("tab", { name: /^Skills ·/ }));
  await user.click(
    screen.getByRole("button", { name: /review Review changes/ }),
  );
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Skill 编辑内容" })).toHaveValue(
      initialContent,
    ),
  );
  return user;
}
async function expectSkillPage() {
  await screen.findByRole("heading", { name: "MCP 与 Skills" });
  expect(
    screen.getByRole("combobox", { name: "配置 Agent" }),
  ).toHaveTextContent("Claude Code");
  expect(await screen.findByRole("tab", { name: /^Skills ·/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("combobox", { name: "作用范围" })).toHaveTextContent(
    "custom-project",
  );
  expect(
    screen.getByRole("button", { name: /review Review changes/ }),
  ).toBeVisible();
}
it("returns from a saved Skill to its list and scope while older task tabs remain open", async () => {
  const user = await openSkill();
  const editor = screen.getByRole("textbox", { name: "Skill 编辑内容" });
  await user.type(editor, " Updated");
  await user.click(
    screen.getByRole("button", { name: "关闭标签：review / SKILL.md" }),
  );
  await user.click(screen.getByRole("button", { name: "保存并关闭" }));
  await expectSkillPage();
  expect(
    screen.getByRole("tab", { name: new RegExp(taskTitle) }),
  ).toHaveAttribute("aria-selected", "false");
  expect(disk.content).toContain("Updated");
  expect(call).toHaveBeenCalledWith(
    "integration_save_skill",
    expect.objectContaining({
      scope: expect.objectContaining({ project }),
      expected: "original",
    }),
  );
});
it("cancel preserves the draft; closing a background tab does not change views; discard restores the list", async () => {
  const user = await openSkill();
  await user.type(
    screen.getByRole("textbox", { name: "Skill 编辑内容" }),
    " Unsaved",
  );
  await user.click(
    screen.getByRole("button", { name: "关闭标签：review / SKILL.md" }),
  );
  await user.click(screen.getByRole("button", { name: "取消", exact: true }));
  expect(screen.getByRole("textbox", { name: "Skill 编辑内容" })).toHaveValue(
    initialContent + " Unsaved",
  );
  await user.click(
    screen.getByRole("button", { name: `关闭标签：${taskTitle}` }),
  );
  expect(screen.getByRole("textbox", { name: "Skill 编辑内容" })).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "关闭标签：review / SKILL.md" }),
  );
  await user.click(screen.getByRole("button", { name: "不保存并关闭" }));
  await expectSkillPage();
  expect(disk.content).toBe(initialContent);
});
it("keeps the editor and draft if save-and-close fails", async () => {
  const user = await openSkill();
  const implementation = vi.mocked(call).getMockImplementation()!;
  vi.mocked(call).mockImplementation(async (command, args) => {
    if (command === "integration_save_skill")
      throw new Error("Cannot write Skill");
    return implementation(command, args);
  });
  await user.type(
    screen.getByRole("textbox", { name: "Skill 编辑内容" }),
    " Draft",
  );
  await user.click(
    screen.getByRole("button", { name: "关闭标签：review / SKILL.md" }),
  );
  await user.click(screen.getByRole("button", { name: "保存并关闭" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "保存并关闭" })).toBeEnabled(),
  );
  expect(screen.getByRole("dialog", { name: "保存文件修改？" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "取消", exact: true }));
  expect(screen.getByRole("textbox", { name: "Skill 编辑内容" })).toHaveValue(
    initialContent + " Draft",
  );
});

it("Back restores an earlier Skills context after visiting a different MCP configuration", async () => {
  const user = await openSkill();
  const rail = within(screen.getByRole("navigation", { name: "工具栏" }));
  await user.click(
    rail.getByRole("button", { name: "Agent 程序", exact: true }),
  );
  await user.click(
    within(screen.getByRole("complementary", { name: "侧边导航" })).getByRole(
      "button",
      { name: "MCP 与 Skills" },
    ),
  );
  await user.click(screen.getByRole("combobox", { name: "配置 Agent" }));
  await user.click(screen.getByRole("option", { name: "Codex" }));
  await user.click(await screen.findByRole("tab", { name: /MCP 服务器/ }));
  await user.click(screen.getByRole("button", { name: "返回上一页" }));
  await screen.findByRole("heading", { name: "Agent 程序" });
  await user.click(screen.getByRole("button", { name: "返回上一页" }));
  await screen.findByRole("textbox", { name: "Skill 编辑内容" });
  await user.click(screen.getByRole("button", { name: "返回上一页" }));
  await expectSkillPage();
});
