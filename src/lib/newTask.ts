import type { Snapshot, Task } from "./types";
import { normalizePermission, type TaskDraft } from "./permissions";

/** Inherit location and agent, never the previous task's prompt or privileges. */
export function newTaskDraft(
  snapshot: Snapshot,
  project: string,
  task?: Task,
): TaskDraft {
  const deviceId = task?.deviceId || "local";
  const agents =
    deviceId === "local"
      ? snapshot.agents
      : snapshot.remoteDevices?.find((d) => d.id === deviceId)?.snapshot
          ?.agents || [];
  const agent =
    agents.find((a) => a.available && a.id === task?.agentId) ||
    agents.find((a) => a.available);
  const released =
    deviceId === "local" &&
    snapshot.temporaryProjects?.some(
      (p) =>
        ["cleaning", "cleaned"].includes(p.status) &&
        (project === p.path ||
          project
            .replace(/\\/g, "/")
            .startsWith(p.path.replace(/\\/g, "/") + "/")),
    );
  return {
    ...(released ? { temporary: true } : {}),
    deviceId,
    dir: project === "all" || released ? "" : project,
    agent: agent?.id || "",
    permission: normalizePermission(agent?.kind || ""),
    providerId: "local",
    mode: "agent",
    prompt: "",
    title: "",
    model: "",
    command: "",
    maxTasks: "4",
    resume: false,
    argsText: "",
    envText: "",
  };
}
