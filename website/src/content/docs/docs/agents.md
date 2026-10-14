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
| Qoder CLI CN | 结构化事件 | 支持，含子 Agent | 原生主会话 |
| Gemini CLI | 结构化事件 | 暂不支持 | OiAgent 启动的会话 |
| OpenCode | 结构化事件 | 暂不支持 | OiAgent 启动的会话 |
| Aider、Goose | 文本输出 | 暂不支持 | 文本上下文 |
| 自定义程序 | 文本或兼容事件 | 不自动识别 | 取决于启动参数 |

## 权限

新建任务和追加消息时，权限菜单按 Agent 区分。Claude Code 包含 Auto Mode；是否可用取决于 CLI 版本、模型和组织设置。不可用时不会自动切换成跳过审批。

权限选项对应原生 CLI：Codex 沙箱级别；Claude 的 plan/default/acceptEdits/auto/dontAsk/bypassPermissions；Qwen 的 plan/default/auto-edit/yolo；Gemini 的 plan/default/auto_edit/yolo；OpenCode 的 plan/build；Aider 的 ask/code/architect；Goose 的 chat/approve/auto。Goose chat 不执行工具，不能等同于可以读取项目的计划模式。额外参数不得覆盖表单管理的输出协议、模型、权限及会话标识。

自定义程序和交互终端使用程序自身权限。OiAgent 的只读菜单不约束任意 Shell 命令。

## Qoder CLI CN

先按[官方安装说明](https://docs.qoder.cn/cli/installation)安装并登录，再在 Agent 程序页刷新。OiAgent 识别 `qodercn` 和兼容命令 `qoderclicn`，也会检查原生安装目录。

- 对话模式使用 SDK 流式协议，显示工具执行、审批和上报的 Token；权限菜单使用 Qoder CN 的原生模式，包含 Auto。运行中切换权限需等待 CLI 确认。
- 任务支持追加消息、恢复原生会话和连接 TUI。终端输入由 Qoder CN 处理。
- 历史记录默认读取 `~/.qoder-cn/projects`；应用启动环境中的 `QODERCN_CONFIG_DIR` 可覆盖该位置。
- MCP 与 Skills 的用户配置位于 `~/.qoder-cn`，项目配置位于 `.qoder`。指令文件使用 `AGENTS.md`，项目还可编辑 `AGENTS.local.md`。
- 默认沿用 Qoder CN 登录。也可在任务环境变量中设置 `QODERCN_PERSONAL_ACCESS_TOKEN`。SDK 认证声明写入权限受限的临时文件，进程结束后删除。

接入依据：[CLI 参数](https://docs.qoder.cn/cli/cli-reference)、[SDK 权限](https://docs.qoder.cn/cli/sdk/permissions)、[会话存储](https://docs.qoder.cn/cli/sessions)。本机核对版本为 1.1.70；已验证命令参数和协议处理，未发起付费模型任务。

## 多个 Agent 接续

每轮消息可以选用不同 Agent。OiAgent 保留同一个任务的记录，将近期对话和工具结果传给接手程序，各程序保留各自的原生会话 ID。

交接最多包含近期 40 条、约 48,000 字符的记录，不会迁移模型内部状态。额外启动参数和环境变量不会直接移交给另一个 Agent。

自定义 CLI 的参数与事件格式见[自定义 Agent 接入](../agent-integration/)。

## 用量与子会话

Codex、Claude Code、Qwen Code、Qoder CLI CN、Gemini CLI 和 OpenCode 可记录已上报的 Token；Aider、Goose 当前使用文本输出，用量显示「未上报」。自定义程序只有输出兼容用量事件时才有统计。

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

## MCP 与 Skills

点击页面右上角的 Agent／范围切换入口，选择配置对象。MCP 服务器与 Skills 分栏管理。两类配置分别搜索；点击列表项进入编辑，右侧「…」提供移除操作。MCP 的新增、编辑在表单页完成，高级 JSON 默认折叠。Skills 的「…」菜单可导入文件夹、复制配置路径；已有 Skill 直接在文件标签中编辑。

### AI 帮写 Skill

在 Skill 编辑器点击「AI 帮写」，打开编写弹窗。编写要求默认填入当前文件的 `description`，可直接修改。使用「设置偏好 → LLM API」中的模型，当前 Skill 内容与所选参考会发送给该服务。

「参考 Skill」可选公开示例，也可粘贴 GitHub 的 `SKILL.md` 文件链接；支持 `github.com/.../blob/.../SKILL.md` 和 `raw.githubusercontent.com/.../SKILL.md`。旁边的来源入口可浏览 Anthropic 和 OpenAI 的公开 Skills。只读取指定文件，不会安装参考 Skill，也不会下载或执行附带脚本。私有仓库和其他网站暂不支持。

生成后在弹窗内比较当前内容与 AI 建议。关闭弹窗保留编写要求和生成结果，可再次打开继续。选择「应用到编辑器」后仍需保存；「放弃」保留原文。生成期间修改了原文，需要重新生成后才能应用，避免覆盖新内容。参考链接读取失败或模型返回格式不正确时会报错，不会用缺少参考的内容替代本次生成。
