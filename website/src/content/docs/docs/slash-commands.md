---
title: 对话命令
description: 在输入框中使用斜杠命令和切换模型。
---

在对话输入框中输入 `/`，选择命令，再填写参数并发送。

## 切换模型

- `/model` 打开模型设置。
- `/model 模型名称` 设置模型。正在运行的 Claude Code、Qwen Code 和 Qoder CN 使用各自 SDK 的控制接口，收到确认后显示切换成功，下一次模型调用生效。
- Codex 的当前执行采用 `exec` 接口，模型设置在下轮执行时应用。需要操作当前 TUI 的模型菜单时，请切换到 **终端**。

可用模型选项来自 CLI 初始化返回的数据；没有返回模型列表时，可以填写模型名称。自定义 API 能使用哪些模型，由对应服务决定。

## Agent 命令

命令列表来自当前会话的 CLI 初始化信息或命令查询接口，包含该会话可用的内置命令、Skills 和插件命令。OiAgent 不内置完整命令表，每次 CLI 建立会话时重新发现；更新程序后，旧版本缓存不再使用。

发送命令前，还会向本次进程核对命令是否存在。CLI 没有提供图形接口、未知命令，以及切换到另一 Agent 或 API 后的原生命令，需要在对应的 **终端** 中执行，不会作为普通消息提交给模型。

首次运行前、旧版 CLI 未返回命令清单，或导入的历史还未通过 OiAgent 续聊时，列表可能为空。切换到终端可使用该程序当前版本的完整命令。

协议参考：[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/slash-commands)、[Qwen Code SDK](https://github.com/QwenLM/qwen-code/blob/main/docs/developers/sdk-python.md)、[Qoder CN SDK](https://docs.qoder.cn/cli/sdk/references-python)、[Codex CLI](https://developers.openai.com/codex/cli/reference)。
