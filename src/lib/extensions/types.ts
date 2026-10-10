export interface ExtensionView {
  id: string;
  title: string;
  icon: string;
  activityBar: boolean;
}
export interface ExtensionManifest {
  schemaVersion: 2;
  apiVersion: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  main: string;
  permissions: string[];
  contributes: {
    views: ExtensionView[];
    commands: { id: string; title: string; view: string }[];
    configuration: {
      id: string;
      title: string;
      type: "string" | "boolean";
      default: string | boolean;
    }[];
  };
}
export interface Extension {
  manifest: ExtensionManifest;
  enabled: boolean;
  revision: string;
  settings: Record<string, string | boolean>;
}
export interface ExtensionPackage extends Extension {
  source: string;
  storage: Record<string, unknown>;
}
export interface ExtensionTab {
  id: string;
  pluginId: string;
  viewId: string;
  title: string;
  icon: string;
  context: ExtensionContext;
}
export interface ExtensionContext {
  project: string | null;
  taskId: string | null;
}
export type FieldValues = Record<string, string | boolean>;
export const permissionNames: Record<string, string> = {
  "workspace.read": "读取当前项目路径和任务 ID",
  "tasks.read": "读取任务列表的标题、状态、项目和用量",
  "tasks.draft": "填写新建任务草稿（由你确认后启动）",
};
export const extensionTabId = (pluginId: string, viewId: string) =>
  `${pluginId}/${viewId}`;
