import { parseCommands } from "./commands";
import {
  decode,
  describeTool,
  exitCode,
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
  state: "running" | "completed" | "failed" | "unknown";
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
      : ["content", "text", "result", "output", "data"].includes(key)
        ? values(item, keys, depth + 1)
        : [],
  );
}
function processIds(value: unknown) {
  const text = plain(value);
  return [
    ...values(value, [
      "session_id",
      "sessionId",
      "background_task_id",
      "task_id",
      "taskId",
      "shell_id",
      "cell_id",
    ]),
    ...Array.from(
      text.matchAll(
        /(?:Process running with session ID|Script running with cell ID|(?:background\s+(?:task|shell)|task)\s+(?:ID|id)[:\s]*)\s*([\w-]+)/g,
      ),
      (m) => m[1],
    ),
  ];
}
function hasBackground(value: unknown) {
  return (
    processIds(value).length > 0 ||
    /(?:running in (?:the )?background|backgrounded)/i.test(plain(value))
  );
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
  if (code !== undefined) return "completed";
  if (background || item.tool.state === "running") return "running";
  return item.tool.state === "completed" ? "completed" : "unknown";
}

/** Join command invocations and their polling results by process ID within each agent scope. */
export function sessionCommands(
  items: TranscriptItem[],
  taskActive: boolean,
): SessionCommand[] {
  const commands: SessionCommand[] = [];
  const processes = new Map<string, SessionCommand>();
  const calls = new Map<string, SessionCommand>();
  function visit(items: TranscriptItem[], scope: string) {
    for (const item of items) {
      if (item.kind !== "tool") continue;
      const { tool } = item;
      const input = record(tool.input);
      const name = tool.name.toLowerCase().replace(/^.*[.:]/, "");
      const parsed = parseCommands(tool.name, tool.input);
      const polls =
        /^(?:write_stdin|taskoutput|bashoutput|read_process_output|task_notification|read|wait)$/.test(
          name,
        );
      const pollIds = [
        ...processIds(tool.input),
        ...values(tool.input, ["file_path", "path"]).map(
          (path) => `file:${path}`,
        ),
        ...parsed.calls.flatMap((call) => processIds(call.input)),
      ];
      let command =
        polls || !parsed.calls.some((call) => call.command)
          ? pollIds
              .map((id) => processes.get(`${scope}:${id}`))
              .find(Boolean) ||
            (typeof input.toolUseId === "string"
              ? calls.get(`${scope}:${input.toolUseId}`)
              : undefined)
          : undefined;
      if (command) {
        const output = cleanCommandOutput(tool.output);
        if (output && !command.output.endsWith(output))
          command.output = `${command.output}\n${output}`.trim();
        const code = exitCode(tool.output);
        const notificationStatus = String(input.status || "");
        if (
          code !== undefined ||
          tool.state === "failed" ||
          /^(completed|failed|stopped|cancelled)$/.test(notificationStatus)
        ) {
          command.exitCode = code;
          command.state =
            tool.state === "failed" ||
            notificationStatus === "failed" ||
            (code !== undefined && code !== 0)
              ? "failed"
              : "completed";
        }
        command.summary = summary(command.output);
      } else if (!polls && describeTool(tool).kind === "command") {
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
        // Wrapped tool scripts are shown once, without pretending conditional commands ran.
        const content =
          shellCalls.map((call) => call.command).join("\n\n") || source;
        if (content) {
          const output = cleanCommandOutput(tool.output);
          const code = exitCode(tool.output);
          const background = hasBackground(tool.output);
          command = {
            id: `${scope}:${item.key}`,
            command: content,
            cwd: shellCalls[0]?.cwd,
            timestamp: item.timestamp,
            output,
            summary: summary(output),
            state: stateFor(item, code, background),
            exitCode: code,
            background,
            language: shellCalls.length ? "bash" : "javascript",
          };
          commands.push(command);
          calls.set(`${scope}:${tool.callId}`, command);
        }
      }
      if (command)
        for (const id of [
          ...processIds(tool.output),
          ...values(tool.output, ["output_file", "outputFile"]).map(
            (path) => `file:${path}`,
          ),
        ])
          processes.set(`${scope}:${id}`, command);
      if (item.nested.length) visit(item.nested, `${scope}/${item.key}`);
    }
  }
  visit(items, "session");
  // Persisted startup output is not proof a process survived the session.
  for (const command of commands)
    if (!taskActive && command.state === "running") command.state = "unknown";
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
      command.language !== "bash" ||
      ["failed", "completed"].includes(command.state) ||
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
