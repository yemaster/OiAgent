import type { TaskDraft } from "./permissions";
import type { Snapshot } from "./types";
import { newTaskDraft } from "./newTask";

export interface TodoInput {
  id: string;
  title: string;
  notes: string;
  project: string;
  important: boolean;
  parentId: string | null;
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
  base: Todo | null;
  sessionId: string;
  returnPage: "todos" | "todos-completed";
  input: TodoInput;
  revision: string;
}
export const emptyTodo = (): TodoInput => ({
  id: "",
  title: "",
  notes: "",
  project: "",
  important: false,
  parentId: null,
});

export function todoPrompt(item: TodoInput, items: Todo[] = []) {
  const lines: string[] = [];
  const seen = new Set<string>([item.id]);
  function children(id: string, level: number) {
    for (const child of items.filter(
      (t) => t.parentId === id && !t.completedAt,
    )) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      lines.push(`${"  ".repeat(level)}- [ ] ${child.title}`);
      if (child.project && child.project !== item.project)
        lines.push(`${"  ".repeat(level + 1)}项目目录：${child.project}`);
      if (child.notes.trim())
        lines.push(
          child.notes
            .trim()
            .split("\n")
            .map((line) => `${"  ".repeat(level + 1)}${line}`)
            .join("\n"),
        );
      if (level < 5) children(child.id, level + 1);
    }
  }
  if (item.id) children(item.id, 0);
  return [
    item.title.trim(),
    item.notes.trim(),
    lines.length ? `未完成的子计划：\n${lines.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
export function taskFromTodo(
  snapshot: Snapshot,
  item: Todo,
  items: Todo[] = [],
): TaskDraft {
  return {
    ...newTaskDraft(snapshot, item.project || "all"),
    title: item.title,
    prompt: todoPrompt(item, items),
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

export function todoDescendants(items: Todo[], id: string): Set<string> {
  const ids = new Set([id]);
  let previous = -1;
  while (previous !== ids.size) {
    previous = ids.size;
    for (const item of items)
      if (item.parentId && ids.has(item.parentId)) ids.add(item.id);
  }
  return ids;
}
export function validateTodoTree(items: Todo[]) {
  const map = new Map(items.map((t) => [t.id, t]));
  if (map.size !== items.length) throw new Error("计划 ID 重复");
  for (const item of items) {
    const seen = new Set([item.id]);
    let parent = item.parentId;
    while (parent) {
      if (seen.has(parent)) throw new Error("不能将计划移入自身或其子计划");
      seen.add(parent);
      if (seen.size > 5) throw new Error("计划最多支持 5 层，请选择其他父计划");
      const ancestor = map.get(parent);
      if (!ancestor) throw new Error("父计划不存在，请刷新列表");
      parent = ancestor.parentId;
    }
  }
}
function reopenAncestors(items: Todo[], id: string, now: string) {
  const map = new Map(items.map((t) => [t.id, t]));
  const seen = new Set<string>();
  let current = map.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.completedAt) {
      current.completedAt = null;
      current.updatedAt = now;
    }
    current = current.parentId ? map.get(current.parentId) : undefined;
  }
}
export function todoDepths(items: Todo[]) {
  const map = new Map(items.map((t) => [t.id, t]));
  return new Map(
    items.map((entry) => {
      const seen = new Set<string>();
      let item: Todo | undefined = entry;
      while (item && !seen.has(item.id)) {
        seen.add(item.id);
        item = item.parentId ? map.get(item.parentId) : undefined;
      }
      return [entry.id, seen.size];
    }),
  );
}
export function todoParentOptions(items: Todo[], id: string) {
  const subtree = todoDescendants(items, id);
  const depths = todoDepths(items);
  const depth = depths.get(id) || 0;
  const height = Math.max(
    1,
    ...items
      .filter((t) => subtree.has(t.id))
      .map((t) => (depths.get(t.id) || 0) - depth + 1),
  );
  return items.filter(
    (t) => !subtree.has(t.id) && (depths.get(t.id) || 0) + height <= 5,
  );
}
export function todoPath(items: Todo[], item: Todo) {
  const names = [item.title];
  const seen = new Set([item.id]);
  let parent = item.parentId;
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const ancestor = items.find((t) => t.id === parent);
    if (!ancestor) break;
    names.unshift(ancestor.title);
    parent = ancestor.parentId;
  }
  return names.join(" / ");
}
export interface TodoNode {
  item: Todo;
  context: boolean;
  children: TodoNode[];
}
/** Keep ancestors for context when filtering, without duplicating matching children. */
export function todoTree(items: Todo[], matches: Todo[]): TodoNode[] {
  const map = new Map(items.map((t) => [t.id, t]));
  const direct = new Set(matches.map((t) => t.id));
  const visible = new Set(direct);
  for (const item of matches) {
    let parent = item.parentId;
    const seen = new Set([item.id]);
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const ancestor = map.get(parent);
      if (!ancestor) break;
      visible.add(parent);
      parent = ancestor.parentId;
    }
  }
  const order = new Map(matches.map((t, i) => [t.id, i]));
  const nodes = new Map(
    [...visible].map((id) => [
      id,
      {
        item: map.get(id)!,
        context: !direct.has(id),
        children: [],
      } as TodoNode,
    ]),
  );
  const roots: TodoNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.item.parentId && nodes.get(node.item.parentId);
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  function rank(node: TodoNode): number {
    return Math.min(
      order.get(node.item.id) ?? Infinity,
      ...node.children.map(rank),
    );
  }
  function sort(branch: TodoNode[]) {
    branch.sort((a, b) => rank(a) - rank(b));
    for (const node of branch) sort(node.children);
  }
  sort(roots);
  return roots;
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
  for (const item of list.items) {
    if (item.parentId === undefined) item.parentId = null;
    if (item.parentId !== null && typeof item.parentId !== "string")
      throw new Error("父计划数据格式异常");
  }
  validateTodoTree(list.items);
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
      parentId: input.parentId || null,
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
    if (command === "remove_todo") {
      for (const child of list.items)
        if (child.parentId === item.id) {
          child.parentId = item.parentId;
          child.updatedAt = now;
        }
      list.items = list.items.filter((t) => t.id !== args.id);
    } else if (command === "complete_todo") {
      if (args.completed) {
        const affected = todoDescendants(list.items, item.id);
        for (const child of list.items)
          if (affected.has(child.id) && !child.completedAt) {
            child.completedAt = now;
            child.updatedAt = now;
          }
      } else reopenAncestors(list.items, item.id, now);
    } else throw new Error("不支持的计划操作");
  }
  validateTodoTree(list.items);
  for (const item of list.items)
    if (!item.completedAt) reopenAncestors(list.items, item.id, now);
  if (list.items.length > 5000) throw new Error("最多保存 5000 条计划");
  list.revision = crypto.randomUUID();
  const text = JSON.stringify(list);
  if (new TextEncoder().encode(text).length > 8 * 1024 * 1024)
    throw new Error("计划总大小超过 8 MB");
  localStorage.setItem(storageKey, text);
  return list;
}
