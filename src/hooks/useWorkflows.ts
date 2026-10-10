import { useCallback, useEffect, useState } from "react";
import { call } from "@/lib/api";
import {
  asGraph,
  type WorkflowDefinition,
  type WorkflowEditor,
} from "@/lib/workflows";
export function useWorkflows(enabled: boolean) {
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [editors, setEditors] = useState<Record<string, WorkflowEditor>>({});
  const [editorId, setEditorId] = useState<string | null>(null);
  const [section, setSection] = useState("library");
  const [query, setQuery] = useState("");
  const refresh = useCallback(async () => {
    try {
      const result = await call<{ definitions: WorkflowDefinition[] }>(
        "workflow_catalog",
      );
      setDefinitions(result.definitions);
      setError("");
      setLoaded(true);
    } catch (error) {
      setError(String(error));
      throw error;
    }
  }, []);
  useEffect(() => {
    // Fetch the persisted library when entering automation; the response updates state asynchronously.
    // oxlint-disable-next-line react/set-state-in-effect
    if (enabled) void refresh().catch(() => {});
  }, [enabled, refresh]);
  function open(definition: WorkflowDefinition, project: string) {
    const existing =
      definition.id &&
      Object.values(editors).find((e) => e.definition.id === definition.id);
    if (existing) {
      setEditorId(existing.sessionId);
      return;
    }
    const sessionId = crypto.randomUUID();
    setEditors((old) => ({
      ...old,
      [sessionId]: {
        sessionId,
        definition: asGraph(structuredClone(definition)),
        project: project === "all" ? "" : project,
      },
    }));
    setEditorId(sessionId);
  }
  function update(id: string, change: Partial<WorkflowEditor>) {
    setEditors((old) =>
      old[id] ? { ...old, [id]: { ...old[id], ...change } } : old,
    );
  }
  return {
    definitions,
    error,
    loaded,
    refresh,
    editors,
    editorId,
    setEditorId,
    editor: editorId ? editors[editorId] : undefined,
    open,
    update,
    section,
    setSection,
    query,
    setQuery,
  };
}
