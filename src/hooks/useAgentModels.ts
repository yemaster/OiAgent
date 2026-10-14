import { useEffect, useState } from "react";
import { call } from "@/lib/api";
import type { Agent } from "@/lib/types";
import type { ModelCatalog } from "@/lib/modelOptions";
const empty: ModelCatalog = {
  models: [],
  defaultModel: "",
  defaultEffort: "",
  defaultServiceTier: "",
};
const requests = new Map<
  string,
  { expires: number; promise: Promise<ModelCatalog> }
>();
export function useAgentModels(
  agent: Agent,
  project: string,
  enabled: boolean,
) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data?: ModelCatalog;
    error?: string;
  }>();
  const key = JSON.stringify([
    agent.id,
    agent.executable,
    agent.version,
    project,
  ]);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const timer = setTimeout(() => {
      let cached = requests.get(key);
      if (!cached || cached.expires < Date.now()) {
        // Deduplicate visible composers and bound memory when visiting many projects.
        if (requests.size >= 48) requests.delete(requests.keys().next().value!);
        const promise = call<ModelCatalog>("agent_models", {
          agentId: agent.id,
          project,
        }).then((data) => (data?.models ? data : empty));
        cached = { expires: Date.now() + 60_000, promise };
        requests.set(key, cached);
      }
      void cached.promise
        .then((data) => {
          if (!disposed) setResult({ key, data });
        })
        .catch((error) => {
          if (!disposed) setResult({ key, error: String(error) });
        });
    }, 150);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [agent.id, key, project, enabled, revision]);
  return {
    catalog: result?.key === key ? result.data || empty : empty,
    error: result?.key === key ? result.error : undefined,
    loading: enabled && result?.key !== key,
    refresh: () => {
      requests.delete(key);
      setResult(undefined);
      setRevision((n) => n + 1);
    },
  };
}
