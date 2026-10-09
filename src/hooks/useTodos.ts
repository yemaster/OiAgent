import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { call } from "@/lib/api";
import {
  emptyTodo,
  type Todo,
  type TodoEditor,
  type TodoList,
} from "@/lib/todos";

export function useTodos(enabled: boolean) {
  const [list, setList] = useState<TodoList>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("all");
  const [important, setImportant] = useState(false);
  const [quick, setQuick] = useState("");
  const [editors, setEditors] = useState<Record<string, TodoEditor>>({});
  const [editorId, setEditorId] = useState<string | null>(null);
  const editor = editorId ? editors[editorId] || null : null;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  function setEditor(action: SetStateAction<TodoEditor | null>) {
    if (!editorId) return;
    setEditors((previous) => {
      const next =
        typeof action === "function"
          ? action(previous[editorId] || null)
          : action;
      const result = { ...previous };
      if (next) result[editorId] = next;
      else delete result[editorId];
      return result;
    });
  }
  function removeEditor(id: string) {
    setEditors((previous) => {
      const result = { ...previous };
      delete result[id];
      return result;
    });
  }
  function openEditor(
    item?: Todo,
    parent?: Todo,
    returnPage: TodoEditor["returnPage"] = "todos",
  ) {
    if (!list) return;
    const existing = Object.values(editors).find((draft) =>
      item
        ? draft.input.id === item.id
        : !draft.input.id && draft.input.parentId === (parent?.id || null),
    );
    if (existing) {
      setEditorId(existing.sessionId);
      return;
    }
    const sessionId = crypto.randomUUID();
    const value: TodoEditor = {
      base: item ? { ...item } : null,
      sessionId,
      returnPage: parent ? "todos" : returnPage,
      revision: list.revision,
      input: item
        ? { ...item }
        : {
            ...emptyTodo(),
            title: parent ? "" : quick,
            parentId: parent?.id || null,
            project: parent ? parent.project : project === "all" ? "" : project,
          },
    };
    setEditors((previous) => ({ ...previous, [sessionId]: value }));
    setEditorId(sessionId);
  }
  const receive = useCallback((next: TodoList) => {
    setList(next);
    setEditors((previous) =>
      Object.fromEntries(
        Object.entries(previous).map(([id, draft]) => {
          const saved = next.items.find((item) => item.id === draft.input.id);
          const base = draft.base;
          const unchanged =
            base &&
            saved &&
            (Object.keys(base) as (keyof Todo)[]).every(
              (key) => base[key] === saved[key],
            );
          return [
            id,
            !draft.input.id || unchanged
              ? { ...draft, revision: next.revision }
              : draft,
          ];
        }),
      ),
    );
  }, []);
  const refresh = useCallback(async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      receive(await call<TodoList>("list_todos"));
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, [receive]);
  useEffect(() => {
    // Read the external store only when the TODO section is opened.
    // oxlint-disable-next-line react/set-state-in-effect
    if (enabled) void refresh();
  }, [enabled, refresh]);
  async function mutate(
    command: string,
    args: Record<string, unknown>,
    expected = list?.revision,
  ) {
    if (lock.current || !expected) return false;
    lock.current = true;
    setBusy(true);
    try {
      receive(await call<TodoList>(command, { ...args, expected }));
      setError("");
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return {
    list,
    error,
    busy,
    refresh,
    mutate,
    query,
    setQuery,
    project,
    setProject,
    important,
    setImportant,
    quick,
    setQuick,
    editor,
    setEditor,
    editors,
    editorId,
    setEditorId,
    openEditor,
    removeEditor,
    collapsed,
    setCollapsed,
  };
}
