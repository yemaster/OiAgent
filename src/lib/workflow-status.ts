import type { WorkflowEdge, WorkflowRun } from "./workflows";

type StepState = WorkflowRun["steps"][number];
// A join can run even though one incoming branch was skipped. Its outgoing
// status must never make that unused branch look traversed.
export function workflowEdgeStatus(
  edge: WorkflowEdge,
  source?: StepState,
  target?: StepState,
): StepState["status"] | "idle" {
  if (!source || !target) return "idle";
  if (
    source.status === "skipped" ||
    target.status === "skipped" ||
    (edge.branch != null &&
      source.branch != null &&
      source.branch !== (edge.branch === "true"))
  )
    return "skipped";
  if (source.status !== "completed") return "pending";
  return target.status;
}

export const workflowNodeSurface: Record<StepState["status"], string> = {
  pending: "bg-muted/30",
  running: "bg-blue-500/5",
  completed: "bg-emerald-500/5",
  approval: "bg-amber-500/5",
  failed: "bg-destructive/5",
  cancelled: "bg-muted/30",
  skipped: "bg-muted/30",
};
