// OiAgent's JSONL boundary stays stable; the official SDK owns CLI transport.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

export function queryOptions(args) {
  const options = { extraArgs: {}, includePartialMessages: true };
  const names = {
    "--model": "model",
    "-m": "model",
    "--resume": "resume",
    "-r": "resume",
    "--session-id": "sessionId",
    "--settings": "settings",
    "--system-prompt": "systemPrompt",
    "--append-system-prompt": "appendSystemPrompt",
    "--agent": "agent",
    "--proxy": "proxy",
  };
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i].split(/=(.*)/s);
    const value = () => {
      const result = inline ?? args[++i];
      if (result === undefined) throw new Error(`Missing value for ${flag}`);
      return result;
    };
    if (
      [
        "-p",
        "--print",
        "--replay-user-messages",
        "--include-partial-messages",
      ].includes(flag)
    )
      continue;
    if (
      [
        "--input-format",
        "--output-format",
        "--permission-prompt-tool",
      ].includes(flag)
    ) {
      value();
      continue;
    }
    if (names[flag]) {
      options[names[flag]] = value();
      continue;
    }
    if (flag === "--permission-mode") {
      const mode = value();
      if (mode === "plan") {
        options.planMode = true;
        options.permissionMode = "default";
      } else
        options.permissionMode =
          {
            accept_edits: "acceptEdits",
            dont_ask: "dontAsk",
            bypass_permissions: "bypassPermissions",
          }[mode] ?? mode;
    } else if (flag === "--no-session-persistence")
      options.persistSession = false;
    else if (flag === "--fork-session") options.forkSession = true;
    else if (flag === "--continue" || flag === "-c") options.continue = true;
    else if (flag === "--add-dir")
      (options.additionalDirectories ??= []).push(value());
    else if (flag === "--setting-sources")
      options.settingSources = value().split(",").filter(Boolean);
    else if (flag.startsWith("--")) {
      const key = flag.slice(2);
      if (Object.hasOwn(options.extraArgs, key))
        throw new Error(`Duplicate Qoder option: ${flag}`);
      options.extraArgs[key] =
        inline ??
        (args[i + 1] !== undefined && !args[i + 1].startsWith("--")
          ? args[++i]
          : null);
    } else throw new Error(`Unsupported Qoder option: ${flag}`);
  }
  // SDK appendSystemPrompt is represented as the qodercli preset.
  if (options.appendSystemPrompt !== undefined) {
    options.systemPrompt =
      options.systemPrompt === undefined
        ? {
            type: "preset",
            preset: "qodercli",
            append: options.appendSystemPrompt,
          }
        : `${options.systemPrompt}\n${options.appendSystemPrompt}`;
    delete options.appendSystemPrompt;
  }
  return options;
}

export async function bridge(
  sdk,
  cli,
  args,
  input,
  output,
  auth,
  stderr = process.stderr,
) {
  const send = (value) => output.write(`${JSON.stringify(value)}\n`);
  const approvals = new Map();
  let daemon,
    query,
    wake,
    ended = false,
    closing;
  const messages = [];
  async function* prompts() {
    while (!ended) {
      if (!messages.length)
        await new Promise((resolve) => {
          wake = resolve;
        });
      while (messages.length) yield messages.shift();
    }
  }
  const options = queryOptions(args);
  const close = () =>
    (closing ??= (async () => {
      ended = true;
      wake?.();
      for (const resolve of approvals.values())
        resolve({ behavior: "deny", message: "Connection closed" });
      approvals.clear();
      try {
        await query?.close();
      } finally {
        await daemon?.stop();
      }
    })());
  async function initialize() {
    daemon = await sdk.startDaemon({
      pathToQoderCLIExecutable: cli,
      auth,
      stderr: (data) => stderr.write(data),
      initializeTimeoutMs: 30_000,
    });
    query = sdk.query({
      prompt: prompts(),
      options: {
        ...options,
        cwd: process.cwd(),
        daemon,
        canUseTool: (tool, input, context) =>
          new Promise((resolve) => {
            const id = randomUUID();
            const finish = (result) => {
              approvals.delete(id);
              context.signal.removeEventListener("abort", abort);
              resolve(result);
            };
            const abort = () => {
              send({ type: "control_cancel_request", request_id: id });
              finish({
                behavior: "deny",
                message: "Permission request cancelled",
              });
            };
            if (context.signal.aborted) {
              abort();
              return;
            }
            approvals.set(id, finish);
            context.signal.addEventListener("abort", abort, { once: true });
            send({
              type: "control_request",
              request_id: id,
              request: {
                type: "can_use_tool",
                tool_name: tool,
                input,
                tool_use_id: context.toolUseID,
                decision_reason: context.decisionReason,
                blocked_path: context.blockedPath,
                description: context.description,
              },
            });
          }),
      },
    });
    const result = await query.initializationResult();
    void (async () => {
      try {
        let models = result.models || [];
        for await (const message of query) {
          if (
            message.type === "system" &&
            message.subtype === "available_models_update"
          )
            models = message.models || models;
          send(
            withContextWindow(
              message,
              models,
              options.extraArgs["context-window"],
            ),
          );
        }
      } catch (error) {
        if (!ended) {
          send({ type: "result", is_error: true, errors: [String(error)] });
          process.exitCode = 1;
          await close();
        }
      }
    })();
    return result;
  }
  async function control(frame) {
    const request = frame.request;
    let result;
    switch (request.type) {
      case "initialize":
        if (query) throw new Error("Already initialized");
        result = await initialize();
        break;
      case "set_permission_mode":
        if (request.mode === "plan") await query.setPlanMode(true);
        else {
          if (query.setPlanMode) await query.setPlanMode(false);
          await query.setPermissionMode(request.mode);
        }
        break;
      case "set_model":
        await query.setModel(request.model || undefined);
        break;
      case "get_usage_info":
        result = { usage: await daemon.getUsageInfo() };
        break;
      case "rewind_files":
        result = await query.rewindFiles(request.user_message_id, {
          dryRun: request.dry_run,
        });
        break;
      case "interrupt":
        result = await query.interrupt();
        break;
      default:
        throw new Error(`Unsupported Qoder control request: ${request.type}`);
    }
    send({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: frame.request_id,
        response: result ?? {},
      },
    });
  }
  let controls = Promise.resolve();
  try {
    for await (const line of createInterface({ input, crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      const frame = JSON.parse(line);
      if (frame.type === "control_response") {
        const response = frame.response;
        approvals.get(response.request_id)?.(
          response.subtype === "success"
            ? response.response
            : {
                behavior: "deny",
                message: response.error || "Permission denied",
              },
        );
      } else if (frame.type === "user") {
        // Native session routing belongs to the SDK, which assigns session_id.
        const { session_id: _sessionId, ...message } = frame;
        messages.push(message);
        wake?.();
      } else if (frame.type === "control_request") {
        controls = controls
          .then(() => control(frame))
          .catch((error) => {
            send({
              type: "control_response",
              response: {
                subtype: "error",
                request_id: frame.request_id,
                error: String(error),
              },
            });
          });
      }
    }
    await controls;
  } finally {
    await close();
  }
}

// Use explicit SDK capacities, never infer a window from the model's name.
export function withContextWindow(message, models, configuredWindow) {
  if (message.parent_tool_use_id) return message;
  const model = message.message?.model || message.model;
  const info = models.find((entry) => (entry.value || entry.id) === model);
  const window = Number(configuredWindow || info?.defaultContextWindow);
  if (!Number.isSafeInteger(window) || window <= 0 || !model) return message;
  return { ...message, context_window: window };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [sdkPath, cli, ...args] = process.argv.slice(2);
    const sdk = await import(pathToFileURL(sdkPath).href);
    const auth = JSON.parse(
      await readFile(process.env.QODER_SDK_AUTH_PAYLOAD_FILE, "utf8"),
    );
    // Do not leak the host's one-shot auth path into the SDK-owned CLI process.
    delete process.env.QODER_SDK_AUTH_PAYLOAD_FILE;
    delete process.env.QODER_AGENT_SDK_ENTRYPOINT;
    await bridge(sdk, cli, args, process.stdin, process.stdout, auth);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ type: "result", is_error: true, errors: [String(error)] })}\n`,
    );
    process.exitCode = 1;
  }
}
