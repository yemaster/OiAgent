import {
  render,
  screen,
  act,
  renderHook,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { IntegrationsPage } from "@/pages/Integrations";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useFiles } from "@/hooks/useFiles";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({
  desktop: true,
  call: vi.fn(),
  pickDirectory: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: async () => () => {} }),
}));
const skill = {
  id: "0:review",
  name: "review",
  description: "Review changes",
  path: "/home/test/.claude/skills/review/SKILL.md",
  content: "---\nname: review\ndescription: Review changes\n---\nReview.",
  revision: "original",
};
beforeEach(() => {
  vi.mocked(call).mockReset();
  vi.mocked(call).mockImplementation(async (command) => {
    if (command === "integration_view")
      return {
        configPath: "config",
        skillsPath: "/home/test/.claude/skills",
        revision: "r",
        servers: [],
        skills: [skill],
        warnings: [],
      };
    if (command === "read_project_file")
      return { content: skill.content, revision: skill.revision };
    if (command === "integration_save_skill")
      return { content: "Updated instructions", revision: "saved" };
  });
});
it("opens the selected skill in the editor without showing a skill editing dialog", async () => {
  const user = userEvent.setup(),
    open = vi.fn();
  render(
    <TooltipProvider>
      <IntegrationsPage
        snapshot={demoSnapshot}
        initialKind="claude"
        onBack={vi.fn()}
        onEditSkill={open}
      />
    </TooltipProvider>,
  );
  await user.click(await screen.findByRole("tab", { name: /Skills/ }));
  await user.click(
    screen.getByRole("button", { name: /review Review changes/ }),
  );
  expect(open).toHaveBeenCalledWith({ kind: "claude", project: null }, skill);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("saves through skill validation and preserves unsaved content when opening the same tab again", async () => {
  const { result } = renderHook(() => useFiles());
  const target = {
    scope: { kind: "claude", project: null },
    id: skill.id,
    name: skill.name,
  };
  await act(async () => {
    await result.current.open(
      "/home/test/.claude/skills/review",
      "SKILL.md",
      "edit",
      undefined,
      target,
    );
  });
  const id = result.current.active!.id;
  act(() =>
    result.current.update(id, (f) => ({
      ...f,
      content: "Updated instructions",
    })),
  );
  await act(async () => {
    await result.current.open(
      "/home/test/.claude/skills/review",
      "SKILL.md",
      "edit",
      undefined,
      target,
    );
  });
  expect(result.current.active?.content).toBe("Updated instructions");
  await act(async () => {
    await result.current.save(id);
  });
  expect(call).toHaveBeenCalledWith("integration_save_skill", {
    scope: target.scope,
    id: target.id,
    content: "Updated instructions",
    expected: "original",
  });
  expect(
    vi
      .mocked(call)
      .mock.calls.some(([command]) => command === "save_project_file"),
  ).toBe(false);
  expect(result.current.active?.revision).toBe("saved");
});
it("keeps a skill draft and offers the disk version when saving detects an external change", async () => {
  const { result } = renderHook(() => useFiles());
  await act(async () => {
    await result.current.open("/skill", "SKILL.md", "edit", undefined, {
      scope: { kind: "claude", project: null },
      id: skill.id,
      name: skill.name,
    });
  });
  const id = result.current.active!.id;
  act(() => result.current.update(id, (f) => ({ ...f, content: "My draft" })));
  vi.mocked(call).mockImplementation(async (command) => {
    if (command === "integration_save_skill") throw new Error("Skill 已修改");
    return { content: "External change", revision: "external" };
  });
  await act(async () => {
    await result.current.save(id);
  });
  await waitFor(() =>
    expect(result.current.active?.conflict?.content).toBe("External change"),
  );
  expect(result.current.active?.content).toBe("My draft");
});
