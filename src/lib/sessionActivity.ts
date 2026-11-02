import { parseCommands } from "./commands";
import {
  decode,
  describeTool,
  plain,
  record,
  type TranscriptItem,
} from "./transcript";

export interface SessionCommand {
  id: string;
  command: string;
  cwd?: string;
  timestamp: string;
  output: string;
  summary: string;
  state: "pending" | "running" | "completed" | "failed" | "stopped" | "unknown";
  /** An unresolved record from an earlier user turn, not current execution evidence. */
  stale?: boolean;
  /** Explicit process termination, including notifications without an exit code. */
  ended?: boolean;
  exitCode?: number;
  background: boolean;
  language: string;
}
export interface SessionService {
  id: string;
  commandId: string;
  command: string;
  host: string;
  port: number;
  url?: string;
  local: boolean;
  reachable?: boolean;
}

// Remove terminal control sequences before extracting human-readable output.
export function cleanCommandOutput(value: unknown): string {
  const text = plain(value)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  return text
    .replace(
      /^(?:Chunk ID:.*|Wall time:.*|Process exited with code.*|Process running with session ID.*|Final output:|Output:)\r?\n?/gm,
      "",
    )
    .trim();
}
function values(value: unknown, keys: string[], depth = 0): string[] {
  if (depth > 6) return [];
  const v = decode(value);
  if (Array.isArray(v))
    return v.flatMap((item) => values(item, keys, depth + 1));
  if (!v || typeof v !== "object") return [];
  const data = record(v);
  return Object.entries(data).flatMap(([key, item]) =>
    keys.includes(key) && (typeof item === "string" || typeof item === "number")
      ? [String(item)]
      : [
            "content",
            "text",
            "result",
            "output",
            "data",
            "task",
            "structuredContent",
            "tool_result",
          ].includes(key)
        ? values(item, keys, depth + 1)
        : [],
  );
}
function processIds(value: unknown) {
  const ids = [
    ...values(value, ["session_id", "sessionId"]).map((id) => `session:${id}`),
    ...values(value, [
      "background_task_id",
      "backgroundTaskId",
      "task_id",
      "taskId",
    ]).map((id) => `task:${id}`),
    ...values(value, ["shell_id", "shellId"]).map((id) => `shell:${id}`),
    ...values(value, ["cell_id", "cellId"]).map((id) => `cell:${id}`),
  ];
  const text = plain(value);
  for (const [pattern, kind] of [
    [/(?:Process running with session ID)\s*([\w-]+)/g, "session"],
    [/(?:Script running with cell ID)\s*([\w-]+)/g, "cell"],
    [/^Command running in background with ID:\s*([\w-]+)/gm, "task"],
    [/(?:background\s+(?:task|shell)|task)\s+(?:ID|id)[:\s]*([\w-]+)/g, "task"],
  ] as const)
    for (const match of text.matchAll(pattern)) ids.push(`${kind}:${match[1]}`);
  return [...new Set(ids)];
}
function hasBackground(value: unknown) {
  return (
    processIds(value).length > 0 ||
    /(?:running in (?:the )?background|backgrounded)/i.test(plain(value))
  );
}
function processExitCode(value: unknown) {
  const numeric = values(value, ["exit_code", "exitCode"]).find((value) =>
    /^-?\d+$/.test(value),
  );
  if (numeric !== undefined) return Number(numeric);
  const match = /^(?:Process exited with code|Exit code:)\s*(-?\d+)\s*$/im.exec(
    plain(value),
  );
  return match ? Number(match[1]) : undefined;
}
const terminalStates = new Set(["completed", "failed", "stopped"]);
function reportedState(value: unknown): SessionCommand["state"] | undefined {
  for (const status of values(value, ["status"])) {
    if (
      ["killed", "stopped", "cancelled", "canceled", "terminated"].includes(
        status,
      )
    )
      return "stopped";
    if (status === "failed") return "failed";
    if (["completed", "exited"].includes(status)) return "completed";
    if (["running", "in_progress", "started"].includes(status))
      return "running";
  }
}
function summary(output: string) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-2)
    .join(" · ")
    .slice(0, 240);
}
function stateFor(
  item: Extract<TranscriptItem, { kind: "tool" }>,
  code: number | undefined,
  background: boolean,
): SessionCommand["state"] {
  if (item.tool.state === "failed" || (code !== undefined && code !== 0))
    return "failed";
  const reported = reportedState(item.tool.output);
  if (reported) return reported;
  // The launcher may return 0 while its explicitly identified background task continues.
  if (background) return "running";
  if (code !== undefined) return "completed";
  if (item.tool.state === "called") return "pending";
  if (item.tool.state === "running") return "running";
  return item.tool.state === "completed" ? "completed" : "unknown";
}

export function isActiveCommand(command: SessionCommand) {
  return command.state === "running" || command.state === "pending";
}

/** Match lifecycle evidence in the owning Agent scope, never infer OS liveness from a port. */
export function sessionCommands(
  items: TranscriptItem[],
  taskActive: boolean,
): SessionCommand[] {
  const commands: SessionCommand[] = [];
  const processes = new Map<string, SessionCommand>();
  const calls = new Map<string, SessionCommand>();
  const unique = (map: Map<string, SessionCommand>, id: string) => {
    const matches = [
      ...new Set(
        [...map]
          .filter(([key]) => key.endsWith(`:${id}`))
          .map(([, command]) => command),
      ),
    ];
    return matches.length === 1 ? matches[0] : undefined;
  };
  function visit(items: TranscriptItem[], scope: string) {
    for (const item of items) {
      if (item.kind === "message") {
        if (item.message.role === "user" && !item.message.synthetic) {
          for (const command of commands)
            if (
              command.id.startsWith(`${scope}:`) ||
              command.id.startsWith(`${scope}/`)
            ) {
              if (isActiveCommand(command)) {
                command.state = "unknown";
                command.stale = true;
              }
            }
        }
        continue;
      }
      const { tool } = item;
      const input = record(tool.input);
      const name = tool.name.toLowerCase().replace(/^.*[.:]/, "");
      const parsed = parseCommands(tool.name, tool.input);
      const polls =
        /^(?:write_stdin|taskoutput|bashoutput|read_process_output|task_notification|read|read_file|wait|taskstop|killshell|kill_process|stop_process)$/.test(
          name,
        );
      const stop = /^(?:taskstop|killshell|kill_process|stop_process)$/.test(
        name,
      );
      const reading = /^(?:read|read_file)$/.test(name);
      const pollIds = [
        ...processIds(tool.input),
        ...values(tool.input, ["file_path", "path"]).map(
          (path) => `file:${path}`,
        ),
        ...parsed.calls.flatMap((call) => processIds(call.input)),
      ];
      const callId =
        typeof input.toolUseId === "string"
          ? input.toolUseId
          : typeof input.tool_use_id === "string"
            ? input.tool_use_id
            : undefined;
      let command =
        polls || !parsed.calls.some((call) => call.command)
          ? pollIds
              .map((id) => processes.get(`${scope}:${id}`))
              .find(Boolean) ||
            (callId ? calls.get(`${scope}:${callId}`) : undefined)
          : undefined;
      // Provider notifications may be delivered at the parent level. Only unambiguous IDs cross scopes.
      if (!command && name === "task_notification")
        command =
          (callId ? unique(calls, callId) : undefined) ||
          pollIds.map((id) => unique(processes, id)).find(Boolean);
      if (command) {
        const output = cleanCommandOutput(tool.output);
        if (output && !command.output.endsWith(output))
          command.output = `${command.output}\n${output}`.trim();
        if (!reading) {
          const code = processExitCode(tool.output);
          const report =
            name === "task_notification"
              ? reportedState(tool.input)
              : reportedState(tool.output);
          const stopped =
            stop &&
            tool.state === "completed" &&
            record(tool.output).success !== false &&
            record(tool.output).is_error !== true;
          if (
            code !== undefined ||
            (report && terminalStates.has(report)) ||
            stopped
          ) {
            command.ended = true;
            command.exitCode = code;
            command.state =
              stopped || report === "stopped"
                ? "stopped"
                : report === "failed" || (code !== undefined && code !== 0)
                  ? "failed"
                  : "completed";
            command.stale = false;
          } else if (
            (report === "running" || hasBackground(tool.output)) &&
            !terminalStates.has(command.state)
          ) {
            command.state = "running";
            command.stale = false;
          }
          // A failed poll or an output-file read is not the process's exit result.
        }
        command.summary = summary(command.output);
      } else if (
        !polls &&
        describeTool(tool).kind === "command" &&
        !item.nested.some(
          (child) =>
            child.kind === "tool" &&
            describeTool(child.tool).kind === "command",
        )
      ) {
        const shellCalls = parsed.calls.filter(
          (call) => call.command && !call.dynamic,
        );
        const source =
          typeof tool.input === "string"
            ? tool.input
            : typeof input.code === "string"
              ? input.code
              : typeof input.script === "string"
                ? input.script
                : "";
        const inferred = !parsed.unresolved && shellCalls.length === 1;
        const content = inferred
          ? shellCalls[0].command!
          : source || shellCalls.map((call) => call.command).join("\n\n");
        if (content) {
          const output = cleanCommandOutput(tool.output);
          const code = processExitCode(tool.output);
          const background = hasBackground(tool.output);
          const state = stateFor(item, code, background);
          command = {
            id: `${scope}:${item.key}`,
            command: content,
            cwd: inferred ? shellCalls[0]?.cwd : undefined,
            timestamp: item.timestamp,
            output,
            summary: summary(output),
            state,
            ended:
              terminalStates.has(state) &&
              (code !== undefined ||
                !!reportedState(tool.output) ||
                state === "failed"),
            exitCode: state === "running" ? undefined : code,
            background,
            language: inferred ? "bash" : "javascript",
          };
          commands.push(command);
          calls.set(`${scope}:${tool.callId}`, command);
        }
      }
      if (command && !reading)
        for (const id of [
          ...processIds(tool.output),
          ...values(tool.output, ["output_file", "outputFile"]).map(
            (path) => `file:${path}`,
          ),
        ])
          processes.set(`${scope}:${id}`, command);
      if (item.nested.length)
        visit(
          item.nested,
          describeTool(tool).kind === "agent" ? `${scope}/${item.key}` : scope,
        );
    }
  }
  visit(items, "session");
  for (const command of commands)
    if (!taskActive && isActiveCommand(command)) command.state = "unknown";
  return commands;
}

const localHosts = new Set([
  "localhost",
  "0.0.0.0",
  "127.0.0.1",
  "::",
  "::1",
  "[::]",
  "[::1]",
]);

/** A browser target, not a claim that a detected TCP listener speaks HTTP. */
export function serviceVisitUrl(service: SessionService): string | undefined {
  try {
    let raw = service.url;
    if (!raw) {
      if (!service.local || !localHosts.has(service.host)) return;
      if (
        !Number.isInteger(service.port) ||
        service.port < 1 ||
        service.port > 65535
      )
        return;
      const host = service.host.replace(/^\[|\]$/g, "");
      const address = ["0.0.0.0", "::"].includes(host)
        ? "localhost"
        : host.includes(":")
          ? `[${host}]`
          : host;
      raw = `http://${address}:${service.port}/`;
    }
    const url = new URL(raw);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return;
    if (["0.0.0.0", "[::]"].includes(url.hostname)) url.hostname = "localhost";
    return url.href;
  } catch {
    return;
  }
}

function endpoint(
  raw: string,
  command: SessionCommand,
  confirmed: boolean,
): SessionService | undefined {
  try {
    const url = new URL(raw);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return;
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    if (!Number.isInteger(port) || port < 1 || port > 65535) return;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const local = localHosts.has(url.hostname);
    if (!confirmed && !(local && url.port)) return;
    const openHost = ["0.0.0.0", "::"].includes(host)
      ? "localhost"
      : url.hostname;
    return {
      id: `${host}:${port}`,
      commandId: command.id,
      command: command.command,
      host,
      port,
      url: `${url.protocol}//${openHost}:${port}/`,
      local,
    };
  } catch {
    return;
  }
}

/** Only command output is evidence. Prompts, prose, command arguments and arbitrary URLs are excluded. */
export function sessionServices(commands: SessionCommand[]): SessionService[] {
  const endpoints = new Map<string, SessionService>();
  for (const command of commands) {
    if (
      command.stale ||
      command.ended ||
      ["failed", "stopped"].includes(command.state) ||
      command.exitCode !== undefined
    )
      continue;
    if (
      /^\s*(?:cat|rg|grep|sed|head|tail|curl|wget|echo|printf)\b/.test(
        command.command,
      )
    )
      continue;
    const lines = command.output.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/\b(?:error|failed|EADDRINUSE|ECONNREFUSED|traceback)\b/i.test(line))
        continue;
      // Curl/test output or echoed source is not a server-start event.
      if (
        /\b(?:curl|wget|fetch|https?\.get|assert|expect)\b|["'`]https?:\/\//i.test(
          line,
        )
      )
        continue;
      const confirmed =
        /(?:\blistening\b|\brunning on\b|\bserving\b|\bserver\b.*\b(?:started|ready|at|on)\b|^\s*(?:➜\s*)?(?:local|network|url)\s*:|uvicorn running|development server at)/i.test(
          line,
        );
      const context =
        /(?:vite|next\.js|ready in|server.*(?:ready|started)|listening)/i.test(
          lines.slice(Math.max(0, i - 3), i + 1).join("\n"),
        );
      for (const match of line.matchAll(
        /https?:\/\/(?:\[[\da-f:]+\]|[\w.-]+)(?::\d{1,5})?(?:\/[^\s<>"'`]*)?/gi,
      )) {
        if (!confirmed && !context) continue;
        const service = endpoint(
          match[0].replace(/[),.;]+$/, ""),
          command,
          confirmed,
        );
        if (service) endpoints.set(service.id, service);
      }
      if (!confirmed) continue;
      const portOnly = /\bport\s*[=:]?\s*(\d{1,5})\b/i.exec(line);
      if (portOnly && !line.includes("http") && !/:\d/.test(line)) {
        const host =
          /(?:address|host)\s*[=:]?\s*["']?([\w.:]+)/i.exec(line)?.[1] ||
          "未报告";
        const port = Number(portOnly[1]);
        if (port > 0 && port <= 65535)
          endpoints.set(`${host}:${port}`, {
            id: `${host}:${port}`,
            commandId: command.id,
            command: command.command,
            host,
            port,
            local: localHosts.has(host),
          });
      }
      const address =
        /(?:\[([\da-f:]+)\]|(localhost|\d{1,3}(?:\.\d{1,3}){3})):(\d{1,5})\b/i.exec(
          line,
        );
      if (address && !line.includes("http")) {
        const host = address[1] || address[2],
          port = Number(address[3]);
        if (port > 0 && port <= 65535)
          endpoints.set(`${host}:${port}`, {
            id: `${host}:${port}`,
            commandId: command.id,
            command: command.command,
            host,
            port,
            local: localHosts.has(host),
          });
      }
    }
  }
  return [...endpoints.values()];
}

/** Static shell words only. Quoted strings stay one word; substitutions are never evaluated. */
function launchSegments(command: string): string[][] {
  const segments: string[][] = [];
  let words: string[] = [],
    word = "",
    quote = "",
    escaped = false;
  const flush = () => {
    if (word) words.push(word);
    word = "";
  };
  for (const c of command) {
    if (escaped) {
      word += c;
      escaped = false;
      continue;
    }
    if (c === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (c === quote) quote = "";
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (";&|\n".includes(c)) {
      flush();
      if (words.length) segments.push(words);
      words = [];
    } else if (/\s/.test(c)) flush();
    else word += c;
  }
  if (quote || escaped) return [];
  flush();
  if (words.length) segments.push(words);
  return segments;
}

/** Launch configuration is a candidate, not proof that a service is listening. */
export function configuredServices(
  commands: SessionCommand[],
): SessionService[] {
  const services = new Map<string, SessionService>();
  for (const command of commands) {
    if (
      command.stale ||
      command.ended ||
      command.language !== "bash" ||
      ["failed", "completed", "stopped"].includes(command.state) ||
      !(command.state === "running" || command.background)
    )
      continue;
    for (const words of launchSegments(command.command)) {
      let i = words[0] === "env" || words[0] === "cross-env" ? 1 : 0;
      const env: Record<string, string> = {};
      while (/^[A-Za-z_][\w]*=/.test(words[i] || "")) {
        const separator = words[i].indexOf("=");
        env[words[i].slice(0, separator)] = words[i].slice(separator + 1);
        i++;
      }
      const executable = (words[i++] || "")
        .split(/[\\/]/)
        .at(-1)
        ?.replace(/\.(?:exe|cmd)$/i, "");
      // Do not extract PORT from echo/cat/curl, scripts, source strings or arbitrary clients.
      if (
        !executable ||
        !/^(node|bun|deno|npm|pnpm|yarn|npx|vite|next|http-server|uvicorn|flask|python[\d.]*)$/.test(
          executable,
        )
      )
        continue;
      const args = words.slice(i);
      if (args.some((arg) => ["-e", "--eval", "-c", "--print"].includes(arg)))
        continue;
      const option = (name: string) => {
        const position = args.indexOf(name);
        const value =
          position >= 0
            ? args[position + 1]
            : args
                .find((arg) => arg.startsWith(`${name}=`))
                ?.slice(name.length + 1);
        return value?.startsWith("-") ? undefined : value;
      };
      const rawPort =
        option("--port") ||
        env.PORT ||
        (/^(vite|next|http-server)$/.test(executable)
          ? option("-p")
          : undefined) ||
        (/^python/.test(executable) &&
        args[0] === "-m" &&
        args[1] === "http.server"
          ? args[2]
          : undefined);
      const host =
        option("--host") || option("--bind") || env.HOST || "localhost";
      if (!rawPort || !/^\d{1,5}$/.test(rawPort) || !localHosts.has(host))
        continue;
      const port = Number(rawPort);
      if (port < 1 || port > 65535) continue;
      // Probe loopback only; do not claim a bind address or HTTP protocol from PORT alone.
      const id = `localhost:${port}`;
      services.set(id, {
        id,
        commandId: command.id,
        command: command.command,
        host: "localhost",
        port,
        local: true,
      });
    }
  }
  return [...services.values()].slice(-64);
}
