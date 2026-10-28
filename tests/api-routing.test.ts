import { expect, it, vi } from "vitest";
import type { Snapshot } from "@/lib/types";

const state = vi.hoisted(() => ({ desktop: true, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => state.desktop,
  invoke: state.invoke,
}));

it("does not allocate preview data on desktop and shares lazy preview state in the browser", async () => {
  const clone = vi.spyOn(globalThis, "structuredClone");
  try {
    const { call } = await import("@/lib/api");
    state.invoke.mockResolvedValue({ tasks: [] });
    expect(await call("get_snapshot")).toEqual({ tasks: [] });
    expect(state.invoke).toHaveBeenCalledWith("get_snapshot", {});
    expect(clone).not.toHaveBeenCalled();

    await call("launch_task", { deviceId: "peer", prompt: "hello" });
    expect(state.invoke).toHaveBeenLastCalledWith("lan_rpc", {
      peerId: "peer",
      command: "launch_task",
      args: { id: undefined, deviceId: undefined, prompt: "hello" },
    });
    expect(clone).not.toHaveBeenCalled();

    state.desktop = false;
    vi.resetModules();
    const browser = await import("@/lib/api");
    expect(clone).not.toHaveBeenCalled();
    const [first, second] = await Promise.all([
      browser.call<Snapshot>("get_snapshot"),
      browser.call<Snapshot>("get_snapshot"),
    ]);
    expect(first.tasks.length).toBeGreaterThan(0);
    expect(first).toEqual(second);
    expect(first.tasks).not.toBe(second.tasks);
    const id = first.tasks[0].id;
    await browser.call("rename_task", { id, title: "preview rename" });
    const updated = await browser.call<Snapshot>("get_snapshot");
    expect(updated.tasks.find((task) => task.id === id)?.title).toBe(
      "preview rename",
    );
    expect(second.tasks[0].title).not.toBe("preview rename");
    expect(state.invoke).toHaveBeenCalledTimes(2);
  } finally {
    clone.mockRestore();
  }
});
