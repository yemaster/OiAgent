import { useState } from "react";
import { expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  asGraph,
  newWorkflow,
  validateWorkflow,
  type WorkflowDefinition,
  type WorkflowEditor,
} from "@/lib/workflows";
import { WorkflowEditorPage } from "@/pages/WorkflowEditor";
import { TooltipProvider } from "@/components/ui/tooltip";
import { demoSnapshot } from "@/lib/demo";

it("migrates only legacy sequences, preserves explicit agent choices and rejects cycles", () => {
  const value = {
    ...newWorkflow(demoSnapshot.agents, "parallel"),
    goal: "审查代码",
  };
  expect(validateWorkflow(value)).toBe("");
  expect(value.steps.every((s) => !s.agentId)).toBe(true);
  expect(value.defaultAgentId).toBeTruthy();
  const legacy = {
    ...value,
    edges: undefined,
    steps: value.steps.map((s) => ({ ...s, agentId: "claude" })),
  };
  const migrated = asGraph(legacy);
  expect(migrated.edges).toHaveLength(3);
  expect(migrated.steps.every((s) => s.agentId === "claude")).toBe(true);
  expect(asGraph({ ...value, edges: [] }).edges).toEqual([]);
  const cycle = {
    id: "cycle",
    source: value.steps[3].id,
    target: value.steps[0].id,
  };
  expect(
    validateWorkflow({ ...value, edges: [...value.edges!, cycle] }),
  ).toContain("循环");
  expect(validateWorkflow({ ...value, defaultAgentId: "" })).toContain("Agent");
  expect(
    validateWorkflow({
      ...value,
      defaultAgentId: "",
      steps: value.steps.map((s) => ({ ...s, agentId: "codex" })),
    }),
  ).toBe("");
  const branch = {
    ...newWorkflow(demoSnapshot.agents, "branch"),
    goal: "检查并修复",
  };
  expect(validateWorkflow(branch)).toBe("");
  expect(
    validateWorkflow({
      ...branch,
      edges: branch.edges!.filter((e) => e.branch !== "false"),
    }),
  ).toContain("两个分支");
});

it("keeps node overrides when changing the default and removes connections when deleting a node", async () => {
  const agents = demoSnapshot.agents.filter((a) => a.available);
  const initial = { ...newWorkflow(agents, "parallel"), goal: "审查项目" };
  initial.steps[1].agentId = agents[0].id;
  let current: WorkflowDefinition = initial;
  function Editor() {
    const [editor, setEditor] = useState<WorkflowEditor>({
      sessionId: "graph",
      definition: initial,
      project: "/fixture",
    });
    return (
      <TooltipProvider>
        <WorkflowEditorPage
          editor={editor}
          snapshot={demoSnapshot}
          onChange={(_, patch) => {
            if (patch.definition) current = patch.definition;
            setEditor((old) => ({ ...old, ...patch }));
          }}
          onSaved={vi.fn()}
          onBack={vi.fn()}
          onCreated={vi.fn()}
          onSettings={vi.fn()}
        />
      </TooltipProvider>
    );
  }
  const user = userEvent.setup();
  render(<Editor />);
  await user.click(screen.getByRole("combobox", { name: "工作流默认 Agent" }));
  await user.click(
    screen.getByRole("option", { name: agents[1].name, exact: true }),
  );
  expect(current.defaultAgentId).toBe(agents[1].id);
  expect(current.steps[0].agentId).toBe("");
  expect(current.steps[1].agentId).toBe(agents[0].id);
  await user.click(screen.getByRole("button", { name: "删除步骤" }));
  await waitFor(() => expect(current.steps).toHaveLength(3));
  expect(
    current.edges!.every(
      (e) =>
        e.source !== initial.steps[0].id && e.target !== initial.steps[0].id,
    ),
  ).toBe(true);
  expect(current.steps[0].agentId).toBe(agents[0].id);
});
