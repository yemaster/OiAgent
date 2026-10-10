---
title: MCP、Skills 与插件
description: 管理原生工具配置、Skill 文件和应用插件。
---

## MCP

打开「Agent 程序 → MCP 与 Skills」，选择 Agent 和作用范围，然后添加本地命令或远程服务。高级 JSON 可以填写原生扩展字段。

目前适配 Codex、Claude Code、Qwen Code、Gemini CLI 和 OpenCode。Codex、OpenCode 支持原生启停字段。

保存配置不会立即启动服务。配置在下次启动 Agent 时应用，项目的信任和工具权限仍由 Agent 自己管理。

## Skills

可以导入含 `SKILL.md` 的目录，也可以新建 Skill。导入会保留附带资源，不执行其中的脚本。

点击条目在 Monaco 文件标签中编辑。保存校验名称、描述和磁盘版本，备份原文。移除时，将完整目录移到同级 `oiagent-skill-backups`，方便恢复。

共享的 `.agents/skills` 可能被多个 Agent 使用，修改前请确认作用范围。

## 应用插件

在「插件」中选择本地插件目录，核对权限后安装，再点击「启用」。插件可以添加工具栏图标、页面标签、搜索命令和设置。

点击插件条目查看页面入口、设置和权限。停用会移除入口并停止插件；卸载会删除插件自己的设置与数据，不影响项目文件或任务。更新使用「插件操作 → 从目录更新」，更新后需要重新启用。

页面和任务、文件共用标签栏，支持拖动排序。切换页面保留表单输入；关闭标签前，请通过插件提供的保存操作保留重要内容。

插件开发见[应用插件开发](/docs/plugin-development/)。

## Agent 配置导入

原有 CLI 插件在「Agent 程序 → 导入配置」管理。已有配置不变，仍可用于任务启动、日志和历史记录。

配置字段见 [Agent 配置协议](https://github.com/yemaster/OiAgent/blob/main/docs/AGENT_PLUGINS.md)。
