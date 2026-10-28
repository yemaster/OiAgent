import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { remoteTask, splitRemoteId } from "./lan";
import type { Task, Detail } from "./types";
export const desktop = isTauri();
export async function call<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (desktop) {
    const target = splitRemoteId(args.id);
    const peerId =
      target?.peerId ||
      (typeof args.deviceId === "string" && args.deviceId !== "local"
        ? args.deviceId
        : undefined);
    if (peerId) {
      const value = await invoke<unknown>("lan_rpc", {
        peerId,
        command,
        args: { ...args, id: target?.id, deviceId: undefined },
      });
      if (command === "get_detail") {
        const d = value as Detail;
        return { ...d, task: remoteTask(d.task, peerId) } as T;
      }
      if (value && typeof value === "object" && "agentKind" in value)
        return remoteTask(value as Task, peerId) as T;
      return value as T;
    }
    return invoke<T>(command, args);
  }
  const { browserCall } = await import("./browserApi");
  return browserCall<T>(command, args);
}

export async function pickDirectory() {
  if (!desktop) throw new Error("选择本机目录需要桌面版");
  return open({ directory: true, multiple: false, title: "选择项目目录" });
}
export async function exportText(filename: string, content: string) {
  if (desktop) {
    const path = await save({ defaultPath: filename });
    if (path) await call("export_file", { path, content });
    return Boolean(path);
  }
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/plain;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}
