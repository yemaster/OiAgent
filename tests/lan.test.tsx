import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewTaskPage } from "@/pages/NewTask";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
import {
  rememberDevices,
  remoteTask,
  splitRemoteId,
  remotePermissions,
  type RemoteDevice,
} from "@/lib/lan";
vi.mock("@/lib/api", () => ({
  desktop: true,
  call: vi.fn(),
  pickDirectory: vi.fn(),
}));
const peer: RemoteDevice = {
  id: "peer-1",
  name: "工作电脑",
  address: "https://192.168.1.2:43120",
  online: true,
  snapshot: {
    name: "工作电脑",
    allowExecution: true,
    agents: [demoSnapshot.agents[0]],
    projects: ["/remote/project"],
    tasks: [],
  },
};
beforeEach(() => {
  vi.mocked(call).mockReset();
  rememberDevices([peer]);
});
describe("remote workspace boundaries", () => {
  it("keeps device and parent IDs separate from local tasks", () => {
    const task = remoteTask(
      { ...demoSnapshot.tasks[0], id: "same-id", parentId: "parent" },
      peer.id,
    );
    expect(task.id).toBe("lan:peer-1:same-id");
    expect(task.parentId).toBe("lan:peer-1:parent");
    expect(task.deviceName).toBe("工作电脑");
    expect(splitRemoteId(task.id)).toEqual({ peerId: "peer-1", id: "same-id" });
    expect(splitRemoteId("same-id")).toBeUndefined();
    expect(
      remotePermissions("claude").some((p) => p.value === "bypassPermissions"),
    ).toBe(false);
  });
  it("starts on the chosen device without local launch overrides", async () => {
    const user = userEvent.setup();
    const created = vi.fn();
    vi.mocked(call).mockResolvedValue(
      remoteTask(demoSnapshot.tasks[0], peer.id),
    );
    render(
      <NewTaskPage
        snapshot={{ ...demoSnapshot, remoteDevices: [peer] }}
        project="all"
        seed={{
          ...demoSnapshot.tasks[0],
          deviceId: peer.id,
          agentId: peer.snapshot!.agents[0].id,
          agentKind: peer.snapshot!.agents[0].kind,
          project: "/remote/project",
          extraArgs: ["--local-option"],
          sessionId: "local-session",
        }}
        onCreated={created}
        onSettings={vi.fn()}
        onAgents={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "运行方式" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("选择项目文件夹")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("额外启动参数")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "启动任务" }));
    await waitFor(() => expect(created).toHaveBeenCalled());
    expect(call).toHaveBeenCalledWith("create_task", {
      deviceId: peer.id,
      input: expect.objectContaining({
        project: "/remote/project",
        extraArgs: [],
        env: {},
        providerId: null,
        resumeSession: null,
      }),
    });
  });
  it("cannot submit tasks to an offline device", () => {
    render(
      <NewTaskPage
        snapshot={{
          ...demoSnapshot,
          remoteDevices: [{ ...peer, online: false }],
        }}
        project="all"
        seed={{ ...demoSnapshot.tasks[0], deviceId: peer.id }}
        onCreated={vi.fn()}
        onSettings={vi.fn()}
        onAgents={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "启动任务" })).toBeDisabled();
  });
});
