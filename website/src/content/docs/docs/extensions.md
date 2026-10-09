---
title: MCP、Skills 与插件
description: 管理原生工具配置、Skill 文件和命令型扩展。
---

## MCP

打开「Agent 程序 → MCP 与 Skills」，选择 Agent 和作用范围，然后添加本地命令或远程服务。高级 JSON 可以填写原生扩展字段。

目前适配 Codex、Claude Code、Qwen Code、Gemini CLI 和 OpenCode。Codex、OpenCode 支持原生启停字段。

保存配置不会立即启动服务。配置在下次启动 Agent 时应用，项目的信任和工具权限仍由 Agent 自己管理。

## Skills

可以导入含 `SKILL.md` 的目录，也可以新建 Skill。导入会保留附带资源，不执行其中的脚本。

点击条目在 Monaco 文件标签中编辑。保存校验名称、描述和磁盘版本，备份原文。移除时，将完整目录移到同级 `oiagent-skill-backups`，方便恢复。

共享的 `.agents/skills` 可能被多个 Agent 使用，修改前请确认作用范围。

## 命令型插件

在独立的「插件」页面导入 JSON manifest，将其他 CLI 接入任务执行、日志和历史管理。

当前插件是命令型扩展，不提供 UI 插件沙箱或插件市场。manifest 字段和示例见 [插件协议](https://github.com/yemaster/OiAgent/blob/main/docs/PLUGINS.md)。
