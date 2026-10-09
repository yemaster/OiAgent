import type { Page } from "./types";
import { PanelLeft, Workflow, Settings, Bot, Puzzle } from "lucide-react";

export const pageNames: Record<Page, string> = {
  tasks: "当前任务",
  history: "历史记录",
  stats: "用量统计",
  new: "新建任务",
  agents: "Agent 程序",
  "claude-api": "Claude Code API 配置",
  supervisor: "自动派发",
  plugins: "插件",
  settings: "设置偏好",
  guide: "使用指南",
};
export function sectionFor(page: Page) {
  if (page === "claude-api") return "agents";
  if (page === "supervisor") return "automation";
  if (page === "agents" || page === "plugins" || page === "settings")
    return page;
  return "workspace";
}
export const sections = [
  { id: "workspace", name: "工作台", page: "tasks", icon: PanelLeft },
  { id: "automation", name: "自动化", page: "supervisor", icon: Workflow },
  { id: "agents", name: "Agent 程序", page: "agents", icon: Bot },
  { id: "plugins", name: "插件", page: "plugins", icon: Puzzle },
  { id: "settings", name: "设置偏好", page: "settings", icon: Settings },
] as const;
