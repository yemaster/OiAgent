import { expect, it } from "vitest";
import { workflowEdgeStatus } from "@/lib/workflow-status";
import type { WorkflowRun } from "@/lib/workflows";

type State = WorkflowRun["steps"][number];
const state = (status: State["status"], branch?: boolean): State => ({
  status,
  branch,
  output: "",
  taskIds: [],
  attempts: 0,
  repairs: 0,
  startedAt: null,
  finishedAt: null,
});
const edge = { id: "edge", source: "source", target: "target" };

it("marks only delivered inputs to a running node as active", () => {
  expect(workflowEdgeStatus(edge, state("completed"), state("running"))).toBe(
    "running",
  );
  expect(workflowEdgeStatus(edge, state("running"), state("pending"))).toBe(
    "pending",
  );
  expect(workflowEdgeStatus(edge, state("completed"), state("pending"))).toBe(
    "pending",
  );
  expect(workflowEdgeStatus(edge, state("completed"), state("completed"))).toBe(
    "completed",
  );
  expect(workflowEdgeStatus(edge, state("completed"), state("approval"))).toBe(
    "approval",
  );
  expect(workflowEdgeStatus(edge, state("completed"), state("failed"))).toBe(
    "failed",
  );
  expect(workflowEdgeStatus(edge)).toBe("idle");
});

it("does not highlight skipped inputs when a join runs or finishes on another branch", () => {
  for (const status of ["running", "completed"] as const) {
    expect(workflowEdgeStatus(edge, state("skipped"), state(status))).toBe(
      "skipped",
    );
    expect(
      workflowEdgeStatus(
        { ...edge, branch: "false" },
        state("completed", true),
        state(status),
      ),
    ).toBe("skipped");
    expect(
      workflowEdgeStatus(
        { ...edge, branch: "true" },
        state("completed", true),
        state(status),
      ),
    ).toBe(status);
  }
});
