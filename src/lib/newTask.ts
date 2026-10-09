import type { Snapshot, Task } from "./types";
import { preferredAgent, preferredPermission } from "./launchPreferences";
import { type TaskDraft } from "./permissions";

/** Inherit project context; permissions come from explicit UI preferences, not task history. */
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
  const agent = preferredAgent(agents, deviceId, task?.agentId);
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
    permission: preferredPermission(deviceId, agent),
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
