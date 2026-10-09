import { createContext, useContext } from "react";
import type { Task } from "./types";
export type ItemMark = { pinned?: boolean; color?: string | null };
export type WorkspaceMarks = Record<string, ItemMark>;
export const taskMarkKey = (task: Task) => `task:${task.id}`;
export const projectMarkKey = (path: string, deviceId?: string) =>
  `project:${JSON.stringify([deviceId || "local", path])}`;
export const OrganizationContext = createContext<{
  marks: WorkspaceMarks;
  busy: boolean;
  ready: boolean;
  mark: (key: string, patch: ItemMark) => Promise<void>;
  archive: (task: Task, archived: boolean) => Promise<boolean>;
}>({
  marks: {},
  busy: false,
  ready: false,
  mark: async () => {},
  archive: async () => false,
});
export const useOrganization = () => useContext(OrganizationContext);
