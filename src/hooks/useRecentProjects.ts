import { useEffect, useMemo, useState } from "react";
import type { Task } from "@/lib/types";

const storageKey = "oiagent-recent-projects";
function readRecent(): Record<string, number> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([, time]) =>
          typeof time === "number" && Number.isFinite(time) && time > 0,
      ),
    );
  } catch {
    return {};
  }
}

export function useRecentProjects(
  projects: string[],
  tasks: Task[],
  project: string,
  context: string,
) {
  const [recent, setRecent] = useState(readRecent);
  useEffect(() => {
    if (!project || project === "all") return;
    const next = { ...readRecent(), [project]: Date.now() };
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Navigation still works when browser storage is unavailable.
    }
    // Synchronize the navigation list with the persisted visit, not task polling.
    // oxlint-disable-next-line react/set-state-in-effect
    setRecent(next);
  }, [project, context]);
  return useMemo(() => {
    const activity = new Map<string, number>();
    for (const task of tasks) {
      const time = Date.parse(task.updatedAt) || 0;
      activity.set(
        task.project,
        Math.max(activity.get(task.project) || 0, time),
      );
    }
    const score = (path: string) => recent[path] || activity.get(path) || 0;
    return [...projects].sort(
      (a, b) => score(b) - score(a) || a.localeCompare(b, "zh-CN"),
    );
  }, [projects, tasks, recent]);
}
