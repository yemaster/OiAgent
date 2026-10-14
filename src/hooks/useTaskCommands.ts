import { useEffect, useState } from "react";
import { call } from "@/lib/api";
import type { CommandCatalog } from "@/lib/slashCommands";
export function useTaskCommands(
  id: string,
  agentId: string,
  enabled: boolean,
  updatedAt: string,
) {
  const [value, setValue] = useState<{ key: string; data: CommandCatalog }>();
  const key = `${id}:${agentId}`;
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    void call<CommandCatalog>("task_commands", { id, agentId })
      .then((data) => {
        if (!disposed && data) setValue({ key, data });
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [id, agentId, enabled, key, updatedAt]);
  return value?.key === key ? value.data : { commands: [], models: [] };
}
