import { browserWorkflows, changeBrowserWorkflow } from "./workflows";
import { browserTodos, changeBrowserTodo } from "./todos";
import { browserTemplates, saveBrowserTemplate } from "./taskTemplates";
import { demoSnapshot, demoDetail } from "./demo";
import type { Snapshot } from "./types";

// Browser preview state is allocated only when preview commands are used.
const sample: Snapshot = structuredClone(demoSnapshot);
export function browserCall<T>(
  command: string,
  args: Record<string, unknown>,
): T {
  if (["prepare_message_edit", "edit_message"].includes(command))
    throw new Error("历史消息编辑仅在桌面版可用");
  if (command === "write_skill" || command === "open_skill_library")
    throw new Error("AI 帮写仅在桌面版可用");
  if (command === "agent_models")
    return {
      models: [],
      defaultModel: "",
      defaultEffort: "",
      defaultServiceTier: "",
    } as T;
  if (command === "task_approvals") return [] as T;
  if (command === "set_task_permission")
    throw new Error("即时切换权限仅在桌面版可用");
  if (command === "answer_approval") throw new Error("审批仅在桌面版可用");
  if (command === "extension_catalog") return { items: [], warnings: [] } as T;
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
  if (command === "agent_quota" || command === "workflow_step_input")
    return null as T;
  if (["task_artifacts", "workflow_artifacts"].includes(command))
    return { files: [], truncated: false } as T;
  if (command === "task_commands") return { commands: [], models: [] } as T;
  if (command === "schedule_catalog") return [] as T;
  if (
    [
      "preview_schedule",
      "save_schedule",
      "set_schedule_enabled",
      "remove_schedule",
      "run_schedule",
    ].includes(command)
  )
    throw new Error("定时执行仅在桌面版可用");
  if (command === "workflow_catalog") return browserWorkflows() as T;
  if (
    ["save_workflow", "remove_workflow", "archive_workflow"].includes(command)
  )
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
