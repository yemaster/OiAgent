import { browserWorkflows, changeBrowserWorkflow } from "./workflows";
import { browserTodos, changeBrowserTodo } from "./todos";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { browserTemplates, saveBrowserTemplate } from "./taskTemplates";
import { demoSnapshot, demoDetail } from "./demo";
import { remoteTask, splitRemoteId } from "./lan";
import type { Task, Detail } from "./types";
import type { Snapshot } from "./types";
export const desktop = isTauri();
const sample: Snapshot = structuredClone(demoSnapshot);
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
  if (command === "workspace_marks")
    return JSON.parse(
      localStorage.getItem("oiagent-workspace-marks") || "{}",
    ) as T;
  if (command === "mark_workspace_item") {
    const marks = JSON.parse(
      localStorage.getItem("oiagent-workspace-marks") || "{}",
    );
    const key = String(args.key);
    const patch = args.patch as Record<string, unknown>;
    marks[key] = { ...marks[key], ...patch };
    localStorage.setItem("oiagent-workspace-marks", JSON.stringify(marks));
    return marks as T;
  }
  if (command === "preview_archived_deletion") return [] as T;
  if (command === "delete_archived_tasks") {
    const options = args.options as
      { keepProjectFiles?: boolean; keepAgentHistory?: boolean } | undefined;
    if (
      options?.keepProjectFiles === false ||
      options?.keepAgentHistory === false
    )
      throw new Error("文件删除仅在桌面版可用");
    const ids = new Set(args.ids as string[]);
    if (
      [...ids].some(
        (id) =>
          !sample.tasks.some(
            (t) =>
              t.id === id &&
              t.archived &&
              !["running", "waiting", "queued"].includes(t.status),
          ),
      )
    )
      throw new Error("只能删除已归档且已结束的记录");
    let previous = -1;
    while (previous !== ids.size) {
      previous = ids.size;
      for (const t of sample.tasks)
        if (t.parentId && ids.has(t.parentId)) ids.add(t.id);
    }
    if (
      sample.tasks.some(
        (t) =>
          ids.has(t.id) && ["running", "waiting", "queued"].includes(t.status),
      )
    )
      throw new Error("记录中仍有未结束任务");
    sample.tasks = sample.tasks.filter((t) => !ids.has(t.id));
    return { ids: [...ids], cleanupWarnings: [] } as T;
  }
  if (command === "workflow_catalog") return browserWorkflows() as T;
  if (["save_workflow", "remove_workflow"].includes(command))
    return changeBrowserWorkflow(command, args) as T;
  if (command === "list_todos") return browserTodos() as T;
  if (
    ["save_todo", "complete_todo", "remove_todo", "move_todo"].includes(command)
  )
    return changeBrowserTodo(command, args) as T;
  if (command === "list_task_templates") return browserTemplates() as T;
  if (command === "save_task_template") return saveBrowserTemplate(args) as T;
  if (command === "remove_task_template")
    return saveBrowserTemplate(args, true) as T;
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
