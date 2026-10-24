import type { ExtensionTab } from "./extensions/types";
import type { IntegrationContext } from "./integrations";
import type { InstructionContext } from "@/pages/Instructions";
import type { OpenFile } from "./files";
import { fileId } from "./files";
import type { Page } from "./types";
import { pageNames } from "./navigation";
import {
  initialEditorLayout,
  type EditorLayout,
  type EditorNode,
} from "./editorGroups";

const KEY = "oiagent-workspace-session-v1";
export type RestoredFile = Pick<
  OpenFile,
  | "id"
  | "project"
  | "path"
  | "mode"
  | "originalPath"
  | "skill"
  | "instruction"
  | "location"
>;
export interface WorkspaceSession {
  version: 1;
  page: Page;
  project: string;
  opened: string[];
  selected: string | null;
  selectedFile: string | null;
  files: RestoredFile[];
  extensions?: ExtensionTab[];
  selectedExtension?: string | null;
  integrationKind?: string;
  integrationContext?: IntegrationContext;
  instructionContext?: InstructionContext;
  layout: EditorLayout;
}
function stablePage(page: Page): Page {
  return page === "schedule-edit"
    ? "schedules"
    : page === "claude-api-edit"
      ? "claude-api"
      : page === "workflow-edit"
        ? "supervisor"
        : page === "todos-edit"
          ? "todos"
          : page;
}
export function readWorkspaceSession(
  storage: Pick<Storage, "getItem"> = localStorage,
): WorkspaceSession | null {
  try {
    const value = JSON.parse(storage.getItem(KEY) || "null");
    if (
      !value ||
      value.version !== 1 ||
      !Object.hasOwn(pageNames, value.page) ||
      typeof value.project !== "string" ||
      !Array.isArray(value.opened) ||
      !Array.isArray(value.files)
    )
      return null;
    const opened = [
      ...new Set(value.opened.filter((id: unknown) => typeof id === "string")),
    ].slice(0, 200) as string[];
    const files: RestoredFile[] = value.files
      .filter(
        (file: RestoredFile) =>
          file &&
          typeof file.project === "string" &&
          typeof file.path === "string" &&
          ["edit", "diff"].includes(file.mode) &&
          file.id === fileId(file.project, file.path, file.mode),
      )
      .slice(0, 100);
    const extensions: ExtensionTab[] = (
      Array.isArray(value.extensions) ? value.extensions : []
    )
      .filter(
        (tab: ExtensionTab) =>
          tab &&
          typeof tab.pluginId === "string" &&
          typeof tab.viewId === "string" &&
          tab.id === `${tab.pluginId}/${tab.viewId}` &&
          typeof tab.title === "string" &&
          typeof tab.icon === "string" &&
          tab.context &&
          (tab.context.project === null ||
            typeof tab.context.project === "string") &&
          (tab.context.taskId === null ||
            typeof tab.context.taskId === "string"),
      )
      .slice(0, 50);
    const available = new Set([
      "page",
      ...opened.map((id) => `task:${id}`),
      ...files.map((file) => `file:${file.id}`),
      ...extensions.map((tab) => `extension:${tab.id}`),
    ]);
    const used = new Set<string>(),
      ids = new Set<string>();
    function parseNode(node: EditorNode, depth = 0): EditorNode | null {
      if (
        !node ||
        depth > 12 ||
        typeof node.id !== "string" ||
        ids.has(node.id)
      )
        return null;
      ids.add(node.id);
      if (node.kind === "group" && Array.isArray(node.tabs)) {
        const tabs = node.tabs.filter((key) => {
          if (!available.has(key) || used.has(key)) return false;
          used.add(key);
          return true;
        });
        if (!tabs.length) return null;
        return {
          kind: "group",
          id: node.id,
          tabs,
          active: tabs.includes(node.active) ? node.active : tabs[0],
          history: Array.isArray(node.history)
            ? node.history.filter((key) => tabs.includes(key))
            : [],
        };
      }
      if (
        node.kind !== "split" ||
        !["horizontal", "vertical"].includes(node.direction)
      )
        return null;
      const first = parseNode(node.first, depth + 1),
        second = parseNode(node.second, depth + 1);
      return first && second
        ? {
            kind: "split",
            id: node.id,
            direction: node.direction,
            first,
            second,
          }
        : first || second;
    }
    const root = parseNode(value.layout?.root);
    const layout = root
      ? {
          root,
          focused:
            typeof value.layout.focused === "string"
              ? value.layout.focused
              : "group-0",
          serial: Math.max(
            Number.isSafeInteger(value.layout.serial) ? value.layout.serial : 1,
            ...[...ids].map((id) => Number(id.split("-").at(-1)) + 1 || 1),
          ),
        }
      : initialEditorLayout([...available], "page");
    return {
      version: 1,
      extensions,
      selectedExtension: extensions.some(
        (tab) => tab.id === value.selectedExtension,
      )
        ? value.selectedExtension
        : null,
      integrationKind:
        typeof value.integrationKind === "string"
          ? value.integrationKind
          : undefined,
      integrationContext:
        value.integrationContext && typeof value.integrationContext === "object"
          ? value.integrationContext
          : undefined,
      instructionContext:
        value.instructionContext &&
        typeof value.instructionContext.kind === "string" &&
        typeof value.instructionContext.project === "string"
          ? value.instructionContext
          : undefined,
      page: stablePage(value.page),
      project: value.project,
      opened,
      selected: opened.includes(value.selected) ? value.selected : null,
      selectedFile: files.some((f) => f.id === value.selectedFile)
        ? value.selectedFile
        : null,
      files,
      layout,
    };
  } catch {
    return null;
  }
}
export function writeWorkspaceSession(
  session: WorkspaceSession,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
) {
  // Never serialize editor contents, API credentials or unsaved configuration forms.
  const files = session.files.map(
    ({
      id,
      project,
      path,
      mode,
      originalPath,
      skill,
      instruction,
      location,
    }) => ({
      id,
      project,
      path,
      mode,
      originalPath,
      skill,
      instruction,
      location,
    }),
  );
  try {
    const encoded = JSON.stringify({
      ...session,
      page: stablePage(session.page),
      files,
    });
    if (storage.getItem(KEY) !== encoded) storage.setItem(KEY, encoded);
  } catch {
    /* A full/disabled WebView store must not prevent closing the app. */
  }
}
