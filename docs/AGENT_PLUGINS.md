# 命令型插件协议 v1

在「Agent 程序 → 导入配置」粘贴 JSON 配置。导入只注册程序，不会安装包、下载文件或立即执行命令。任务启动时才运行该程序。

```json
{
  "schemaVersion": 1,
  "type": "agent",
  "name": "My Agent",
  "executable": "/usr/local/bin/my-agent",
  "args": ["--prompt", "{prompt}", "--directory", "{project}"]
}
```

`name`、`executable`、`args` 为必填字段。`executable` 可使用绝对路径或 PATH 中的命令名。参数必须是字符串数组；参数内的 `{prompt}` 和 `{project}` 会按字面值替换。没有 `{prompt}` 时，Prompt 会作为最后一个参数追加。工作目录始终为选定的项目目录。

程序通过标准输出和标准错误返回记录。普通文本会显示在任务对话/日志中。可以选择输出以下 JSONL 事件，以提供更丰富的信息：

```jsonl
{"type":"thread.started","thread_id":"native-session-id"}
{"type":"item.completed","item":{"type":"agent_message","text":"正在处理任务"}}
{"type":"item.completed","item":{"type":"command_execution","command":"npm test","aggregated_output":"tests passed"}}
{"type":"turn.completed","usage":{"input_tokens":1200,"output_tokens":180,"cached_input_tokens":500}}
```

退出码 0 表示完成；其他退出码表示失败。没有用量事件时显示未上报，不会推算。所有输出保留在原始日志中。使用普通命令模式时不会解释 `|`、`&&`、`$()` 等 Shell 语法；明确启动 Shell 的插件自行负责其执行行为。

`examples/demo-agent.mjs` 是无 LLM 的离线示例。将 `examples/plugin.json` 中脚本路径替换为本项目的绝对路径，导入后选择“离线测试 Agent”启动任务即可检查整个生命周期。

本协议用于接入 CLI。需要添加 OiAgent 页面、图标或设置时，使用[应用插件 API](PLUGINS.md)。两种扩展独立管理；既有 CLI 配置无需迁移。
