---
title: 指令文件
description: 管理 AGENTS.md、CLAUDE.md、QWEN.md 和 GEMINI.md。
---

## 打开配置

在「Agent 程序 → 指令文件」选择 Agent 和作用范围，也可以从 Agent 卡片直接进入。

- **用户 · 所有项目**：个人习惯和通用约定。
- **项目目录**：项目的构建、测试、代码风格和团队约定。

点击「编辑」或「创建」会打开文件标签。创建操作先打开空白编辑器，保存后才写入磁盘。保存会检查外部修改并备份原文件，未保存内容仍按普通文件草稿处理。

## 默认文件位置

| Agent | 用户范围 | 项目范围 |
| --- | --- | --- |
| Codex | `~/.codex/AGENTS.md` | `AGENTS.md` |
| Claude Code | `~/.claude/CLAUDE.md` | `CLAUDE.md`、`.claude/CLAUDE.md`、`CLAUDE.local.md` |
| Qwen Code | `~/.qwen/QWEN.md` | `QWEN.md`、`.qwen/QWEN.local.md` |
| Gemini CLI | `~/.gemini/GEMINI.md` | `GEMINI.md` |
| OpenCode | `~/.config/opencode/AGENTS.md` | `AGENTS.md` |

Codex 同时提供 `AGENTS.override.md`，由 CLI 按原生优先级加载。自定义的 `CODEX_HOME`、`CLAUDE_CONFIG_DIR` 和 `XDG_CONFIG_HOME` 会影响对应用户目录。

页面只管理当前范围的常用文件，不代表完整的最终指令。父目录、子目录、导入文件、自定义文件名和兼容回退仍由 Agent 决定。当前未提供 Aider、Goose 和自定义程序的专用指令适配，可以从项目文件中编辑。

## 写什么

写 Agent 无法仅从代码中确定的约定，例如：

```md
# 项目约定

- 使用 pnpm 管理依赖。
- 修改接口后更新对应的类型定义和接口文档。
- 提交前运行 pnpm lint 和相关单元测试。
- 数据库结构变更先给出迁移方案，确认后执行。
```

这些是写法示例，请替换为项目实际约定。不要写入密钥。仅供本机使用的指令文件应按需要加入 Git 忽略规则，OiAgent 不自动修改 `.gitignore`。

## 何时生效

保存后，新会话按 CLI 原生规则读取。已有会话需要使用相应 CLI 的重新加载方式，或重新开启会话。OiAgent 不把保存动作伪装成已向运行中的模型同步。

已有文件的备份位于同目录的 `.oiagent-instruction-backups`。指令文件只接受不超过 256 KB 的 UTF-8 文本，符号链接需要在原生配置中管理。
