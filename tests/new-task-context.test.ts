import { expect, it } from "vitest";
import { demoSnapshot } from "@/lib/demo";
import { newTaskDraft } from "@/lib/newTask";
it("inherits project and agent without reusing prompts, sessions or elevated permissions", () => {
  const agent = demoSnapshot.agents.find((a) => a.available)!;
  const task = {
    ...demoSnapshot.tasks[0],
    agentId: agent.id,
    permission: "danger-full-access",
    extraArgs: ["--danger"],
    envKeys: ["SECRET"],
  };
  const draft = newTaskDraft(demoSnapshot, task.project, task);
  expect(draft).toMatchObject({
    dir: task.project,
    agent: agent.id,
    deviceId: "local",
    prompt: "",
    title: "",
    resume: false,
    argsText: "",
    envText: "",
  });
  expect(draft.permission).not.toBe("danger-full-access");
});
it("keeps a remote task on its own device, while explicit local project context stays local", () => {
  const agent = {
    ...demoSnapshot.agents[0],
    id: "remote-agent",
    available: true,
  };
  const task = {
    ...demoSnapshot.tasks[0],
    deviceId: "peer",
    agentId: agent.id,
    project: "/remote/project",
  };
  const snapshot = {
    ...demoSnapshot,
    remoteDevices: [
      {
        id: "peer",
        name: "Peer",
        address: "",
        online: true,
        snapshot: {
          name: "Peer",
          allowExecution: true,
          agents: [agent],
          tasks: [],
          projects: [task.project],
        },
      },
    ],
  };
  expect(newTaskDraft(snapshot, task.project, task)).toMatchObject({
    deviceId: "peer",
    agent: agent.id,
    dir: "/remote/project",
  });
  expect(newTaskDraft(snapshot, "/local/project")).toMatchObject({
    deviceId: "local",
    dir: "/local/project",
  });
});

it("starts a new temporary project instead of reusing a cleaned directory", () => {
  const task = demoSnapshot.tasks[0];
  const result = newTaskDraft(
    {
      ...demoSnapshot,
      temporaryProjects: [
        {
          id: "temporary",
          path: task.project,
          createdAt: task.createdAt,
          status: "cleaned",
          cleanupAfter: null,
        },
      ],
    },
    task.project,
    task,
  );
  expect(result.dir).toBe("");
  expect(result.temporary).toBe(true);
  expect(result.resume).toBe(false);
});
