import { useEffect, useState } from "react";

export const RESOURCE_IDLE_MS = 30_000;

/** Release reloadable data, never the component's drafts or running native task. */
export function useIdleResource<T>(active: boolean, preserve = false) {
  const [value, setValue] = useState<T | null>(null);
  const retained = value !== null;
  useEffect(() => {
    if (active || preserve || !retained) return;
    const timer = setTimeout(() => setValue(null), RESOURCE_IDLE_MS);
    return () => clearTimeout(timer);
  }, [active, preserve, retained]);
  return [value, setValue] as const;
}
