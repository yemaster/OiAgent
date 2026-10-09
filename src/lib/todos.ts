import type { TaskDraft } from "./permissions";
import type { Snapshot } from "./types";
import { newTaskDraft } from "./newTask";

export interface TodoInput {
  id: string;
  title: string;
  notes: string;
  project: string;
  important: boolean;
}
export interface Todo extends TodoInput {
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
export interface TodoList {
  items: Todo[];
  revision: string;
}
export interface TodoEditor {
  input: TodoInput;
  revision: string;
}
export const emptyTodo = (): TodoInput => ({
  id: "",
  title: "",
  notes: "",
  project: "",
  important: false,
});

export function todoPrompt(item: TodoInput) {
  return [item.title.trim(), item.notes.trim()].filter(Boolean).join("\n\n");
}
export function taskFromTodo(snapshot: Snapshot, item: Todo): TaskDraft {
  return {
    ...newTaskDraft(snapshot, item.project || "all"),
    title: item.title,
    prompt: todoPrompt(item),
  };
}
export function filterTodos(
  items: Todo[],
  completed: boolean,
  query: string,
  project: string,
  important: boolean,
) {
  const search = query.trim().toLocaleLowerCase();
  return items
    .filter(
      (t) =>
        Boolean(t.completedAt) === completed &&
        (project === "all" || t.project === project) &&
        (!important || t.important) &&
        `${t.title} ${t.notes} ${t.project}`
          .toLocaleLowerCase()
          .includes(search),
    )
    .sort((a, b) =>
      completed
        ? b.completedAt!.localeCompare(a.completedAt!) ||
          b.id.localeCompare(a.id)
        : Number(b.important) - Number(a.important) ||
          b.createdAt.localeCompare(a.createdAt) ||
          b.id.localeCompare(a.id),
    );
}

// Browser preview uses its own storage; the desktop app uses todos.json.
const storageKey = "oiagent-todos";
export function browserTodos(): TodoList {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return { items: [], revision: "initial" };
  const list = JSON.parse(raw) as TodoList;
  if (
    !Array.isArray(list.items) ||
    typeof list.revision !== "string" ||
    list.items.some(
      (t) =>
        !t ||
        [t.id, t.title, t.notes, t.project, t.createdAt, t.updatedAt].some(
          (v) => typeof v !== "string",
        ) ||
        typeof t.important !== "boolean" ||
        (t.completedAt !== null && typeof t.completedAt !== "string"),
    )
  ) {
    throw new Error("计划数据格式异常，原数据未修改");
  }
  return list;
}
export function changeBrowserTodo(
  command: string,
  args: Record<string, unknown>,
): TodoList {
  const list = browserTodos();
  if (args.expected !== list.revision)
    throw new Error("计划已修改，请刷新列表后重试。未保存的内容会保留。");
  const now = new Date().toISOString();
  if (command === "save_todo") {
    const input = args.item as TodoInput;
    const title = input.title.trim();
    const project = input.project.trim();
    if (!title || [...title].length > 200)
      throw new Error("请填写计划名称，最多 200 字");
    if (
      new TextEncoder().encode(input.notes).length > 32768 ||
      new TextEncoder().encode(project).length > 4096 ||
      project.includes("\0")
    )
      throw new Error("备注最多 32 KB，项目路径无效或过长");
    const fields: TodoInput = {
      id: input.id,
      title,
      notes: input.notes,
      project,
      important: input.important,
    };
    if (!fields.id)
      list.items.push({
        ...fields,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      });
    else {
      const index = list.items.findIndex((t) => t.id === fields.id);
      if (index < 0) throw new Error("计划不存在，请刷新列表");
      list.items[index] = { ...list.items[index], ...fields, updatedAt: now };
    }
  } else {
    const item = list.items.find((t) => t.id === args.id);
    if (!item) throw new Error("计划不存在，请刷新列表");
    if (command === "remove_todo")
      list.items = list.items.filter((t) => t.id !== args.id);
    else if (command === "complete_todo") {
      if (Boolean(item.completedAt) !== Boolean(args.completed)) {
        item.completedAt = args.completed ? now : null;
        item.updatedAt = now;
      }
    } else throw new Error("不支持的计划操作");
  }
  if (list.items.length > 5000) throw new Error("最多保存 5000 条计划");
  list.revision = crypto.randomUUID();
  const text = JSON.stringify(list);
  if (new TextEncoder().encode(text).length > 8 * 1024 * 1024)
    throw new Error("计划总大小超过 8 MB");
  localStorage.setItem(storageKey, text);
  return list;
}
