import { TooltipProvider } from "@/components/ui/tooltip";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { IntegrationsPage } from "@/pages/Integrations";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({
  desktop: true,
  call: vi.fn(),
  pickDirectory: vi.fn(),
}));
beforeEach(() =>
  vi
    .mocked(call)
    .mockReset()
    .mockImplementation(async (command) =>
      command === "integration_view"
        ? {
            configPath: "/config.json",
            skillsPath: "/skills",
            revision: "r",
            warnings: [],
            servers: [
              { name: "github", config: { command: "npx" } },
              { name: "browser", config: { url: "https://example.com" } },
            ],
            skills: [
              {
                id: "review",
                name: "review",
                description: "Review changes",
                content: "",
                revision: "s",
                path: "/skills/review/SKILL.md",
              },
            ],
          }
        : undefined,
    ),
);
it("keeps actions in menus and editing on its own page, retaining search on return", async () => {
  const user = userEvent.setup();
  render(
    <TooltipProvider>
      <IntegrationsPage
        snapshot={demoSnapshot}
        onBack={vi.fn()}
        onEditSkill={vi.fn()}
        initialKind="claude"
      />
    </TooltipProvider>,
  );
  await user.type(
    await screen.findByRole("textbox", { name: "搜索 MCP 服务器" }),
    "github",
  );
  expect(
    screen.queryByRole("button", { name: /browser 远程服务/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /^移除/ }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /github 本地进程/ }));
  expect(
    screen.getByRole("heading", { name: "编辑 MCP 服务器" }),
  ).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("启动命令"), "-changed");
  await user.click(screen.getByRole("button", { name: "保存", exact: true }));
  await waitFor(() =>
    expect(call).toHaveBeenCalledWith(
      "integration_save_mcp",
      expect.objectContaining({
        scope: { kind: "claude", project: null },
        name: "github",
        config: { command: "npx-changed" },
        expected: "r",
      }),
    ),
  );
  expect(
    await screen.findByRole("textbox", { name: "搜索 MCP 服务器" }),
  ).toHaveValue("github");
  await user.click(screen.getByRole("tab", { name: /^Skills/ }));
  expect(screen.getByRole("textbox", { name: "搜索 Skills" })).toHaveValue("");
  await user.click(screen.getByRole("button", { name: "Skills 列表操作" }));
  expect(screen.getByRole("menuitem", { name: "导入文件夹" })).toBeVisible();
});
