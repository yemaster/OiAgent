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

权限选项对应原生 CLI：Codex 沙箱级别；Claude 的 plan/default/acceptEdits/auto/dontAsk/bypassPermissions；Qwen 的 plan/default/auto-edit/yolo；Gemini 的 plan/default/auto_edit/yolo；OpenCode 的 plan/build；Aider 的 ask/code/architect；Goose 的 chat/approve/auto。Goose chat 不执行工具，不能等同于可以读取项目的计划模式。额外参数不得覆盖表单管理的输出协议、模型、权限及会话标识。

自定义程序和交互终端使用程序自身权限。OiAgent 的只读菜单不约束任意 Shell 命令。

## 多个 Agent 接续

每轮消息可以选用不同 Agent。OiAgent 保留同一个任务的记录，将近期对话和工具结果传给接手程序，各程序保留各自的原生会话 ID。

交接最多包含近期 40 条、约 48,000 字符的记录，不会迁移模型内部状态。额外启动参数和环境变量不会直接移交给另一个 Agent。

自定义 CLI 的参数与事件格式见[自定义 Agent 接入](../agent-integration/)。

## 用量与子会话

Codex、Claude Code、Qwen Code、Gemini CLI 和 OpenCode 可记录已上报的 Token；Aider、Goose 当前使用文本输出，用量显示「未上报」。自定义程序只有输出兼容用量事件时才有统计。

子 Agent 记录独立计量，通过父会话继续操作；不提供子会话的继续按钮，避免误续父会话。

## 官方接口依据

- [Codex 事件协议源码](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs)：调用 ID、子 Agent 父线程关系。
- [Claude Headless](https://code.claude.com/docs/en/headless)、[Subagents](https://code.claude.com/docs/en/sub-agents)：stream-json、工具内容块及子会话。
- [Qwen Headless](https://qwenlm.github.io/qwen-code-docs/zh/users/features/headless/)：stream-json 与无头模式。
- [Gemini Headless](https://geminicli.com/docs/cli/headless/)、[配置](https://geminicli.com/docs/reference/configuration/)、[输出类型源码](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/output/types.ts)：message、tool_use、tool_result、result 及统计字段。
- [OpenCode CLI](https://opencode.ai/docs/cli/)、[run 源码](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts)：run --format json、part 事件、每步 Token 及会话 ID。
- [Aider 选项](https://aider.chat/docs/config/options.html)、[聊天模式](https://aider.chat/docs/usage/modes.html)：单次 message、ask 模式、关闭自动提交。
- [Goose CLI](https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/goose-cli-commands.md)：run、text 输出及模型选项。

核对日期：2026-10-08。本机已安装 Codex、Claude Code、Qwen Code，历史扫描通过；新增四个程序未安装，已验证启动参数和合成协议事件，没有进行真实模型调用。CLI 未来变更需要更新适配器。
