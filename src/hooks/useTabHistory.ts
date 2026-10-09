import { useCallback, useLayoutEffect, useRef } from "react";
import type { Page } from "@/lib/types";

export type TabLocation =
  { kind: "task"; id: string } | { kind: "file"; id: string; taskId?: string };
export type PageLocation = { kind: "page"; page: Page; project: string };
export type WorkspaceLocation = TabLocation | PageLocation;
export const tabKey = (tab: TabLocation) => `${tab.kind}:${tab.id}`;

// Task and file tabs share one MRU list, independent of their visual order.
export function useTabHistory(current: WorkspaceLocation, available: string[]) {
  const history = useRef<TabLocation[]>([]);
  const active = useRef(current);
  const openTabs = useRef(available);
  const lastPage = useRef<PageLocation>({
    kind: "page",
    page: "tasks",
    project: "all",
  });
  useLayoutEffect(() => {
    active.current = current;
    openTabs.current = available;
    if (current.kind === "page") lastPage.current = current;
    else
      history.current = [
        current,
        ...history.current.filter((t) => tabKey(t) !== tabKey(current)),
      ];
  }, [current, available]);
  return useCallback((closed: TabLocation): WorkspaceLocation | null => {
    const key = tabKey(closed);
    const remaining = new Set(openTabs.current.filter((id) => id !== key));
    history.current = history.current.filter((t) => remaining.has(tabKey(t)));
    if (active.current.kind === "page" || tabKey(active.current) !== key)
      return null;
    const next = history.current[0] || lastPage.current;
    active.current = next;
    return next;
  }, []);
}
