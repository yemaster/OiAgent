import type { Page, SettingsPageId } from "./types";
import {
  PanelLeft,
  Workflow,
  Settings,
  Bot,
  Puzzle,
  ListTodo,
} from "lucide-react";

export const pageNames: Record<Page, string> = {
  tasks: "当前任务",
  todos: "未完成",
  "todos-completed": "已完成",
  "todos-edit": "编辑计划",
  history: "历史记录",
  archived: "已归档",
  stats: "用量统计",
  new: "新建任务",
  agents: "Agent 程序",
  instructions: "指令文件",
  integrations: "MCP 与 Skills",
  "claude-api": "Claude Code API 配置",
  "claude-api-edit": "编辑 API 配置",
  supervisor: "工作流",
  "workflow-edit": "编辑工作流",
  plugins: "插件",
  settings: "通用设置",
  "settings-appearance": "界面设置",
  "settings-llm": "LLM API",
  "settings-lan": "局域网连接",
  "settings-about": "关于",
  guide: "使用指南",
};
export function isSettingsPage(page: Page): page is SettingsPageId {
  return page === "settings" || page.startsWith("settings-");
}
export function sectionFor(page: Page) {
  if (page === "todos" || page.startsWith("todos-")) return "todos";
  if (isSettingsPage(page)) return "settings";
  if (
    ["claude-api", "claude-api-edit", "integrations", "instructions"].includes(
      page,
    )
  )
    return "agents";
  if (page === "supervisor" || page === "workflow-edit") return "automation";
  if (page === "agents" || page === "plugins") return page;
  return "workspace";
}
export const sections = [
  { id: "workspace", name: "工作台", page: "tasks", icon: PanelLeft },
  { id: "todos", name: "TODO List", page: "todos", icon: ListTodo },
  { id: "automation", name: "自动化", page: "supervisor", icon: Workflow },
  { id: "agents", name: "Agent 程序", page: "agents", icon: Bot },
  { id: "plugins", name: "插件", page: "plugins", icon: Puzzle },
  { id: "settings", name: "设置偏好", page: "settings", icon: Settings },
] as const;
