---
title: Agent 支持范围
description: 各 Agent 的历史导入、工具事件和会话恢复能力。
---

OiAgent 会检测程序路径和版本，不自动安装或登录。所有下列程序均可启动任务并保存本次执行记录。

| Agent | 执行记录 | 已有历史导入 | 会话接续 |
| --- | --- | --- | --- |
| Codex | 结构化事件 | 支持，含子 Agent | 原生主会话 |
| Claude Code | 结构化事件 | 支持，含子 Agent | 原生主会话 |
| Qwen Code | 结构化事件 | 支持，含子 Agent | 原生主会话 |
| Gemini CLI | 结构化事件 | 暂不支持 | OiAgent 启动的会话 |
| OpenCode | 结构化事件 | 暂不支持 | OiAgent 启动的会话 |
| Aider、Goose | 文本输出 | 暂不支持 | 文本上下文 |
| 自定义程序 | 文本或兼容事件 | 不自动识别 | 取决于启动参数 |

## 权限

新建任务和追加消息时，权限菜单按 Agent 区分。Claude Code 包含 Auto Mode；是否可用取决于 CLI 版本、模型和组织设置。不可用时不会自动切换成跳过审批。

自定义程序和交互终端使用程序自身权限。OiAgent 的只读菜单不约束任意 Shell 命令。

## 多个 Agent 接续

每轮消息可以选用不同 Agent。OiAgent 保留同一个任务的记录，将近期对话和工具结果传给接手程序，各程序保留各自的原生会话 ID。

交接最多包含近期 40 条、约 48,000 字符的记录，不会迁移模型内部状态。额外启动参数和环境变量不会直接移交给另一个 Agent。

更多协议细节见仓库的 [Agent 支持文档](https://github.com/yemaster/OiAgent/blob/main/docs/AGENT-SUPPORT.md)。
