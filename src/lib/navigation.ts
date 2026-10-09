import type { Page, SettingsPageId } from "./types";
import { PanelLeft, Workflow, Settings, Bot, Puzzle } from "lucide-react";

export const pageNames: Record<Page, string> = {
  tasks: "当前任务",
  history: "历史记录",
  stats: "用量统计",
  new: "新建任务",
  agents: "Agent 程序",
  integrations: "MCP 与 Skills",
  "claude-api": "Claude Code API 配置",
  supervisor: "自动派发",
  plugins: "插件",
  settings: "通用设置",
  "settings-appearance": "界面设置",
  "settings-llm": "LLM API",
  "settings-about": "关于",
  guide: "使用指南",
};
export function isSettingsPage(page: Page): page is SettingsPageId {
  return page === "settings" || page.startsWith("settings-");
}
export function sectionFor(page: Page) {
  if (isSettingsPage(page)) return "settings";
  if (["claude-api", "integrations"].includes(page)) return "agents";
  if (page === "supervisor") return "automation";
  if (page === "agents" || page === "plugins") return page;
  return "workspace";
}
export const sections = [
  { id: "workspace", name: "工作台", page: "tasks", icon: PanelLeft },
  { id: "automation", name: "自动化", page: "supervisor", icon: Workflow },
  { id: "agents", name: "Agent 程序", page: "agents", icon: Bot },
  { id: "plugins", name: "插件", page: "plugins", icon: Puzzle },
  { id: "settings", name: "设置偏好", page: "settings", icon: Settings },
] as const;
