import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskTemplates } from "@/components/workspace/TaskTemplates";
import { ComposerTools } from "@/components/workspace/ComposerTools";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  browserTemplates,
  saveBrowserTemplate,
  templateVariables,
  fillTemplate,
  insertTemplate,
} from "@/lib/taskTemplates";
vi.mock("@/lib/api", () => ({
  desktop: false,
  call: async (command: string, args: Record<string, unknown>) =>
    command === "list_task_templates"
      ? browserTemplates()
      : saveBrowserTemplate(args, command === "remove_task_template"),
}));
beforeEach(() => localStorage.removeItem("oiagent-task-templates"));
it("fills repeated variables literally and preserves existing draft text", () => {
  expect(templateVariables("{{ scope }} / {{scope}} / {{test}}")).toEqual([
    "scope",
    "test",
  ]);
  expect(fillTemplate("{{scope}} {{scope}}", { scope: "$& / src/a.ts" })).toBe(
    "$& / src/a.ts $& / src/a.ts",
  );
  expect(insertTemplate("draft", "template")).toBe("draft\n\ntemplate");
  expect(insertTemplate("draft", "template", true)).toBe("template");
});
it("persists edits and rejects stale writes", () => {
  const library = browserTemplates();
  const edited = { ...library.templates[0], prompt: "Changed" };
  saveBrowserTemplate({ template: edited, expected: library.revision });
  expect(browserTemplates().templates[0].prompt).toBe("Changed");
  expect(() =>
    saveBrowserTemplate({ template: edited, expected: library.revision }),
  ).toThrow("刷新");
});
it.each([false, true])(
  "requires variables and preserves the draft when opened through tools: %s",
  async (tools) => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TooltipProvider>
        {tools ? (
          <ComposerTools
            prompt="已有要求"
            onChange={onChange}
            onSettings={vi.fn()}
            onAdvanced={vi.fn()}
          />
        ) : (
          <TaskTemplates prompt="已有要求" onChange={onChange} />
        )}
      </TooltipProvider>,
    );
    if (tools) {
      await user.click(screen.getByRole("button", { name: "任务工具" }));
      await user.click(screen.getByRole("menuitem", { name: "任务模板" }));
    } else await user.click(screen.getByRole("button", { name: "任务模板" }));
    const insert = await screen.findByRole("button", { name: "插入模板" });
    expect(insert).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "范围" }), "src/auth");
    await user.click(insert);
    expect(onChange).toHaveBeenCalledWith(
      expect.stringContaining("已有要求\n\n"),
    );
    expect(onChange.mock.calls[0][0]).toContain("src/auth");
  },
);
