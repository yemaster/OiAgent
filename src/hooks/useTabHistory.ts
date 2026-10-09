import { useCallback, useLayoutEffect, useRef } from "react";
import type { Page } from "@/lib/types";
import type { IntegrationContext } from "@/lib/integrations";
import type { InstructionContext } from "@/pages/Instructions";

export type TabLocation =
  { kind: "task"; id: string } | { kind: "file"; id: string; taskId?: string };
export type PageLocation = {
  kind: "page";
  page: Page;
  project: string;
  integrationKind?: string;
  integrationContext?: IntegrationContext;
  instructionContext?: InstructionContext;
  providerEditorId?: string;
};
export type WorkspaceLocation = TabLocation | PageLocation;
export const tabKey = (tab: TabLocation) => `${tab.kind}:${tab.id}`;
const locationKey = (location: WorkspaceLocation) =>
  location.kind === "page"
    ? JSON.stringify([
        location.kind,
        location.page,
        location.project,
        location.providerEditorId,
      ])
    : tabKey(location);

// Pages participate in visit order too: older open tabs must not take priority
// over the configuration page that just opened an editor.
export function useTabHistory(
  current: WorkspaceLocation,
  available: string[],
  pageAvailable: (page: PageLocation) => boolean = () => true,
) {
  const history = useRef<WorkspaceLocation[]>([]);
  const active = useRef(current);
  const openTabs = useRef(available);
  const validPage = useRef(pageAvailable);
  const lastPage = useRef<PageLocation>({
    kind: "page",
    page: "tasks",
    project: "all",
  });
  useLayoutEffect(() => {
    active.current = current;
    openTabs.current = available;
    validPage.current = pageAvailable;
    if (current.kind === "page") lastPage.current = current;
    history.current = [
      current,
      ...history.current.filter(
        (visit) =>
          locationKey(visit) !== locationKey(current) &&
          (visit.kind === "page" || available.includes(tabKey(visit))),
      ),
    ];
  }, [current, available, pageAvailable]);
  return useCallback((closed: TabLocation): WorkspaceLocation | null => {
    const key = tabKey(closed);
    // Batch closes may run before React renders again. Remove closed tabs now.
    openTabs.current = openTabs.current.filter((id) => id !== key);
    const remaining = new Set(openTabs.current);
    history.current = history.current.filter((visit) =>
      visit.kind === "page"
        ? validPage.current(visit)
        : remaining.has(tabKey(visit)),
    );
    if (active.current.kind === "page" || tabKey(active.current) !== key)
      return null;
    const next: WorkspaceLocation =
      history.current[0] ||
      (validPage.current(lastPage.current)
        ? lastPage.current
        : { kind: "page", page: "tasks", project: "all" });
    active.current = next;
    return next;
  }, []);
}
