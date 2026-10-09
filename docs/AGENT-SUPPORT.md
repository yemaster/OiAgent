# Agent 支持范围

OiAgent 自动检查以下程序的安装路径及版本，不自动安装或登录。安装后在 Agent 页面重新扫描。自定义可执行程序和命令型插件没有品牌限制。

| Agent                   | 启动任务并保存记录 | 工具步骤       | 导入已有外部历史 | 继续会话             | 用量           |
| ----------------------- | ------------------ | -------------- | ---------------- | -------------------- | -------------- |
| Codex                   | 支持               | 结构化         | 支持，含子 Agent | 支持主会话           | 已上报 Token   |
| Claude Code             | 支持               | 结构化         | 支持，含子 Agent | 支持主会话           | 已上报 Token   |
| Qwen Code               | 支持               | 结构化         | 支持，含子 Agent | 支持主会话           | 已上报 Token   |
| Gemini CLI              | 支持               | 结构化         | 暂不支持         | 支持本应用启动的会话 | 已上报 Token   |
| OpenCode                | 支持               | 结构化         | 暂不支持         | 支持本应用启动的会话 | 已上报 Token   |
| Aider                   | 支持               | 文本输出       | 暂不支持         | 文本上下文接续       | 未上报         |
| Goose                   | 支持               | 文本输出       | 暂不支持         | 文本上下文接续       | 未上报         |
| 自定义程序 / 命令型插件 | 支持               | 文本或兼容事件 | 不自动猜测格式   | 由程序参数配置       | 仅兼容事件上报 |

内置只读选项映射到各程序自己的模式：Codex read-only、Claude/Qwen/Gemini plan、OpenCode plan、Aider ask、Goose chat。Goose chat 不执行工具，不能等同于可以读取项目的计划模式。允许修改项目时 Goose 使用 approve，仍需遵守其原生审批。自定义程序和交互终端沿用程序自身的权限。

无头 CLI 要求交互时，应在交互终端运行。本应用不提供所有供应商原生审批协议的代理。子 Agent 的继续会话按钮不开放，避免共用 session ID 时误续父会话。

## 官方接口依据

- [Codex 事件协议源码](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs)：调用 ID、子 Agent 父线程关系。
- [Claude Headless](https://code.claude.com/docs/en/headless)、[Subagents](https://code.claude.com/docs/en/sub-agents)：stream-json、工具内容块及子会话。
- [Qwen Headless](https://qwenlm.github.io/qwen-code-docs/zh/users/features/headless/)：stream-json 与无头模式。
- [Gemini Headless](https://geminicli.com/docs/cli/headless/)、[配置](https://geminicli.com/docs/reference/configuration/)、[输出类型源码](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/output/types.ts)：message、tool_use、tool_result、result 及统计字段。
- [OpenCode CLI](https://opencode.ai/docs/cli/)、[run 源码](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts)：run --format json、part 事件、每步 Token 及会话 ID。
- [Aider 选项](https://aider.chat/docs/config/options.html)、[聊天模式](https://aider.chat/docs/usage/modes.html)：单次 message、ask 模式、关闭自动提交。
- [Goose CLI](https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/goose-cli-commands.md)：run、text 输出及模型选项。

核对日期：2026-10-08。本机已安装 Codex、Claude Code、Qwen Code，历史扫描通过；新增四个程序未安装，已验证启动参数和合成协议事件，没有进行真实模型调用。CLI 未来变更需要更新适配器。


## 权限、API 与任务接续

权限菜单按原生 CLI 区分：Codex 的沙箱级别；Claude 的 plan/default/acceptEdits/dontAsk/bypassPermissions；Qwen 的 plan/default/auto-edit/yolo；Gemini 的 plan/default/auto_edit/yolo；OpenCode 的 plan/build；Aider 的 ask/code/architect；Goose 的 chat/approve/auto。默认仍是只读或计划模式，更宽权限由用户明确选择。额外参数不得覆盖表单管理的输出协议、模型、权限及会话标识。

Claude API 配置参考 [cc-switch](https://github.com/farion1231/cc-switch) 的多配置管理和 [Claude 模型配置](https://code.claude.com/docs/en/model-config) 的环境变量映射，采用每个子进程的环境注入。自定义本机 Claude settings 中与这些环境变量冲突的配置仍需用户自行排除；未实现全局配置切换和请求代理。

运行中追加消息参考 [Cursor 消息队列](https://cursor.com/docs/agent/overview)，当前实现本轮结束后按序执行。跨 Agent 通过有长度上限的对话文本交接；原生会话与 API 配置分别关联，任务历史与累计用量保留在同一任务。子 Agent 记录继续通过父会话操作。
