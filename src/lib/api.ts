import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { demoSnapshot, demoDetail } from "./demo";
import type { Snapshot } from "./types";
export const desktop = isTauri();
const sample: Snapshot = structuredClone(demoSnapshot);
export async function call<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (desktop) return invoke<T>(command, args);
  if (command === "get_snapshot") return structuredClone(sample) as T;
  if (command === "get_detail") {
    const task = sample.tasks.find((t) => t.id === args.id);
    if (!task) throw new Error("任务不存在");
    return demoDetail(task) as T;
  }
  if (command === "archive_task") {
    const t = sample.tasks.find((t) => t.id === args.id);
    if (t) t.archived = Boolean(args.archived);
    return undefined as T;
  }
  if (command === "rename_task") {
    const task = sample.tasks.find((t) => t.id === args.id);
    if (task) task.title = String(args.title);
    return undefined as T;
  }
  if (command === "llm_status") return { configured: false } as T;
  throw new Error("此操作需要桌面版。请运行 npm run desktop。");
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
