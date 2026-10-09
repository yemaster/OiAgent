import { parseCommands } from "./commands";
import type { Message, ToolEvent } from "./types";
export type TranscriptItem =
  | { kind: "message"; key: string; message: Message }
  | {
      kind: "tool";
      key: string;
      tool: ToolEvent;
      timestamp: string;
      nested: TranscriptItem[];
    };
export function decode(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
export function record(value: unknown): Record<string, unknown> {
  const v = decode(value);
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
export function plain(value: unknown): string {
  const v = decode(value);
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(plain).filter(Boolean).join("\n");
  const o = record(v);
  for (const key of [
    "text",
    "output",
    "stdout",
    "content",
    "result",
    "message",
    "response",
  ]) {
    if (o[key] != null)
      return [plain(o[key]), plain(o.stderr)].filter(Boolean).join("\n");
  }
  return Object.entries(o)
    .filter(
      ([k]) =>
        ![
          "signature",
          "encrypted_content",
          "data",
          "chunk_id",
          "session_id",
          "wall_time_seconds",
          "exit_code",
        ].includes(k),
    )
    .map(([k, v]) => `${fieldName(k)}：${plain(v)}`)
    .join("\n");
}
export function fieldName(key: string) {
  return (
    (
      {
        command: "命令",
        cmd: "命令",
        workdir: "工作目录",
        cwd: "工作目录",
        file_path: "文件",
        path: "路径",
        pattern: "查找",
        query: "搜索",
        url: "网址",
        prompt: "任务说明",
        description: "说明",
        subagent_type: "Agent 类型",
        agent_type: "Agent 类型",
        model: "模型",
        offset: "起始位置",
        limit: "数量上限",
        old_string: "修改前",
        new_string: "修改后",
        content: "内容",
        status: "状态",
        error: "错误",
        name: "名称",
        input: "输入",
        arguments: "参数",
        directory: "目录",
        result: "结果",
      } as Record<string, string>
    )[key] || key
  );
}
function legacy(message: Message): ToolEvent {
  const [name, ...lines] = message.text.split("\n");
  const value = decode(lines.join("\n"));
  const result = name.startsWith("执行结果");
  return {
    callId: "",
    name: result ? "tool_result" : name,
    input: result ? null : value,
    output: result ? value : null,
    state: result ? "completed" : "called",
  };
}
function merged(previous: ToolEvent, next: ToolEvent): ToolEvent {
  return {
    ...previous,
    ...next,
    name: previous.name || next.name,
    input:
      next.input == null
        ? previous.input
        : typeof previous.input === "object" && typeof next.input === "object"
          ? { ...record(previous.input), ...record(next.input) }
          : next.input,
    output: next.output == null ? previous.output : next.output,
    childIds: [
      ...new Set([...(previous.childIds || []), ...(next.childIds || [])]),
    ],
  };
}
/** Join by call ID, never by adjacency: parallel tools can finish out of order. */
export function buildTranscript(messages: Message[]): TranscriptItem[] {
  const timeline: TranscriptItem[] = [];
  const calls = new Map<string, Extract<TranscriptItem, { kind: "tool" }>>();
  const nested = new Map<string, Message[]>();
  messages.forEach((message, index) => {
    const parent = message.parentCallId || message.tool?.parentCallId;
    if (parent) {
      nested.set(parent, [
        ...(nested.get(parent) || []),
        {
          ...message,
          parentCallId: undefined,
          tool: message.tool
            ? { ...message.tool, parentCallId: null }
            : undefined,
        },
      ]);
      return;
    }
    if (message.tool || message.role === "tool") {
      const tool = message.tool || legacy(message);
      const existing = tool.callId ? calls.get(tool.callId) : undefined;
      if (existing) existing.tool = merged(existing.tool, tool);
      else {
        const step: Extract<TranscriptItem, { kind: "tool" }> = {
          kind: "tool",
          key: tool.callId || `tool-${index}`,
          tool: { ...tool },
          timestamp: message.timestamp,
          nested: [],
        };
        timeline.push(step);
        if (tool.callId) calls.set(tool.callId, step);
      }
    } else {
      const previous = timeline.at(-1);
      if (
        message.delta &&
        previous?.kind === "message" &&
        previous.message.role === message.role
      )
        previous.message = {
          ...previous.message,
          text: previous.message.text + message.text,
        };
      else timeline.push({ kind: "message", key: `message-${index}`, message });
    }
  });
  nested.forEach((messages, id) => {
    const parent = calls.get(id);
    if (parent) parent.nested = buildTranscript(messages);
    else
      timeline.push({
        kind: "tool",
        key: `subagent-${id}`,
        tool: {
          callId: id,
          name: "Agent",
          input: null,
          output: null,
          state: "called",
        },
        timestamp: messages[0]?.timestamp || "",
        nested: buildTranscript(messages),
      });
  });
  return timeline;
}
export type ToolKind =
  "command" | "read" | "edit" | "search" | "web" | "agent" | "plan" | "tool";
export function describeTool(tool: ToolEvent): {
  kind: ToolKind;
  title: string;
  detail: string;
  code?: string;
  cwd?: string;
} {
  const name = tool.name.toLowerCase().replace(/^.*[.:]/, "");
  const input = record(tool.input);
  const source = typeof tool.input === "string" ? tool.input : "";
  const cmd = plain(input.cmd || input.command);
  const path = plain(
    input.file_path ||
      input.filePath ||
      input.path ||
      input.absolute_path ||
      input.target_file,
  );
  if (
    /spawn_agent|^agent$|^task$|subagent|send_message|wait_agent|^wait$|close_agent|resume_agent/.test(
      name,
    )
  )
    return {
      kind: "agent",
      title: /wait/.test(name)
        ? "等待子 Agent"
        : /send_message/.test(name)
          ? "发送消息给子 Agent"
          : /close/.test(name)
            ? "关闭子 Agent"
            : "派发子 Agent",
      detail: plain(
        input.description ||
          input.task_name ||
          input.subagent_type ||
          input.agent_type ||
          input.prompt,
      ).split("\n")[0],
    };
  if (/plan|todo/.test(name))
    return { kind: "plan", title: "更新任务计划", detail: "" };
  if (/apply_patch|file_change|write|edit|replace/.test(name))
    return {
      kind: "edit",
      title: "修改文件",
      detail:
        path ||
        /\*\*\* (?:Update|Add|Delete) File: (.+)/.exec(source)?.[1] ||
        "",
      code: source || undefined,
    };
  if (/read|cat_file/.test(name))
    return { kind: "read", title: "读取文件", detail: path };
  if (/web|browse|fetch/.test(name) || input.search_query || input.url)
    return {
      kind: "web",
      title: "检索网页",
      detail: plain(
        input.query || input.search_query || input.url || input.open,
      ),
    };
  if (/search|grep|glob|find/.test(name))
    return {
      kind: "search",
      title: "搜索文件",
      detail: plain(input.pattern || input.query || input.glob || path),
    };
  if (cmd || /shell|bash|terminal|exec|^js$|^python$/.test(name)) {
    const parsed = parseCommands(tool.name, tool.input);
    const commands = parsed.calls.filter((c) => c.command);
    return {
      kind: "command",
      title:
        commands.length > 1
          ? `执行命令 · ${commands.length} 条`
          : commands.length
            ? "执行命令"
            : parsed.calls.length
              ? `调用工具 · ${parsed.calls.length} 项`
              : "运行工具脚本",
      detail:
        commands[0]?.command ||
        parsed.calls.map((c) => c.name).join("、") ||
        plain(input.title || input.description) ||
        "查看执行内容",
      code: commands.map((c) => c.command).join("\n\n") || undefined,
      cwd: commands[0]?.cwd,
    };
  }
  return {
    kind: "tool",
    title: name === "tool_result" ? "执行结果" : tool.name || "工具执行",
    detail: plain(input.description || input.title),
  };
}
export function exitCode(value: unknown): number | undefined {
  const v = decode(value);
  const o = record(v);
  if (typeof o.exit_code === "number") return o.exit_code;
  if (typeof o.exitCode === "number") return o.exitCode;
  if (Array.isArray(v)) {
    for (const item of v) {
      const code = exitCode(item);
      if (code !== undefined) return code;
    }
  }
  for (const key of ["text", "content", "result"]) {
    if (o[key] != null) {
      const code = exitCode(o[key]);
      if (code !== undefined) return code;
    }
  }
  if (typeof v === "string") {
    const match =
      /(?:Process exited with code|exit(?:ed)?(?: code|_code)?)[:\s]+(-?\d+)/i.exec(
        v,
      );
    if (match) return Number(match[1]);
  }
  return undefined;
}
