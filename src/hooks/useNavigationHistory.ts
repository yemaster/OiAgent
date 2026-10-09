import { useLayoutEffect, useRef, useState } from "react";
import type { WorkspaceLocation } from "./useTabHistory";
import type { TaskDraft } from "@/lib/permissions";
import type { Page, Task } from "@/lib/types";

export interface NavigationVisit {
  location: WorkspaceLocation;
  draft?: TaskDraft;
  seed?: Task;
  newTaskKey: number;
  returnToDraft: Page | null;
  integrationKind?: string;
}
function key(visit: NavigationVisit) {
  const location = visit.location;
  if (location.kind !== "page") return `${location.kind}:${location.id}`;
  return JSON.stringify([
    location.page,
    location.project,
    location.providerEditorId,
    location.todoEditorId,
    ["new", "supervisor"].includes(location.page) ? visit.seed?.id : null,
    ["new", "supervisor"].includes(location.page) ? visit.newTaskKey : null,
  ]);
}

/** Chronological back navigation, independent of the tab-close MRU history. */
export function useNavigationHistory(
  current: NavigationVisit,
  available: (visit: NavigationVisit) => boolean,
) {
  const [past, setPast] = useState<NavigationVisit[]>([]);
  const previous = useRef(current);
  const returning = useRef<string | null>(null);
  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = current;
    if (key(from) === key(current)) return;
    if (returning.current !== key(current)) {
      // Keep history in memory only; updating task status or draft text adds no entry.
      setPast((visits) => [...visits, from].slice(-100));
    }
    returning.current = null;
  }, [current]);
  const targetIndex = past.findLastIndex(
    (visit) => available(visit) && key(visit) !== key(current),
  );
  function back() {
    if (returning.current || targetIndex < 0) return null;
    const next = past[targetIndex];
    returning.current = key(next);
    setPast(past.slice(0, targetIndex));
    return next;
  }
  return { canGoBack: targetIndex >= 0, back };
}
