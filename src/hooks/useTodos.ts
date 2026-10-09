import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "@/lib/api";
import type { TodoEditor, TodoList } from "@/lib/todos";

export function useTodos(enabled: boolean) {
  const [list, setList] = useState<TodoList>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("all");
  const [important, setImportant] = useState(false);
  const [quick, setQuick] = useState("");
  const [editor, setEditor] = useState<TodoEditor | null>(null);
  const refresh = useCallback(async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      setList(await call<TodoList>("list_todos"));
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, []);
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
      setList(await call<TodoList>(command, { ...args, expected }));
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
  };
}
