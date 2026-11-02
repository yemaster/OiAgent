import { expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import {
  bridge,
  queryOptions,
  withContextWindow,
} from "../src-tauri/scripts/qoder-sdk-bridge.mjs";

it("attaches the SDK's explicit model capacity without inventing one or rewriting usage", () => {
  const message = {
    type: "assistant",
    message: {
      model: "qoder",
      usage: { input_tokens: 0, context_usage_ratio: 0.3 },
    },
  };
  expect(
    withContextWindow(message, [
      { value: "qoder", defaultContextWindow: 200000 },
    ]),
  ).toEqual({ ...message, context_window: 200000 });
  expect(withContextWindow(message, [], "1000000").context_window).toBe(
    1000000,
  );
  expect(
    withContextWindow(message, [
      { value: "other", defaultContextWindow: 200000 },
    ]),
  ).toBe(message);
  expect(
    withContextWindow(message, [
      { value: "qoder", availableContextWindows: [200000, 1000000] },
    ]),
  ).toBe(message);
  const child = { ...message, parent_tool_use_id: "child" };
  expect(withContextWindow(child, [], "1000000")).toBe(child);
});

function fixture() {
  const input = new PassThrough();
  const output = new PassThrough();
  const frames: any[] = [];
  output.on("data", (data) => frames.push(JSON.parse(data.toString())));
  const daemon = {
    stop: vi.fn(),
    getUsageInfo: vi.fn(async () => ({ userQuota: { percentage: 25 } })),
  };
  let stop: () => void;
  const stopped = new Promise<void>((resolve) => {
    stop = resolve;
  });
  const query = {
    initializationResult: vi.fn(async () => ({
      models: [{ id: "model" }],
      commands: [],
    })),
    close: vi.fn(async () => {
      stop();
    }),
    rewindFiles: vi.fn(async () => ({
      canRewind: true,
      filesChanged: ["/tmp/a"],
    })),
    setPermissionMode: vi.fn(),
    setPlanMode: vi.fn(),
    setModel: vi.fn(),
    async *[Symbol.asyncIterator]() {
      await stopped;
      yield { type: "system", subtype: "status", status: "closed" };
    },
  };
  const sdk = {
    startDaemon: vi.fn(async () => daemon),
    query: vi.fn(() => query),
  };
  const done = bridge(
    sdk,
    "/cli with spaces/qodercn",
    ["-p", "--resume", "native-id"],
    input,
    output,
    { type: "qodercli" },
  );
  const send = (value: unknown) => input.write(`${JSON.stringify(value)}\n`);
  const control = (id: string, type: string, args = {}) =>
    send({
      type: "control_request",
      request_id: id,
      request: { type, ...args },
    });
  return { input, frames, sdk, daemon, query, done, send, control };
}

it("uses the daemon SDK, preserves resumable options and rejects ambiguous duplicate flags", () => {
  expect(
    queryOptions([
      "-p",
      "--input-format",
      "stream-json",
      "--permission-prompt-tool",
      "stdio",
      "--permission-mode",
      "plan",
      "--model=x",
      "--resume",
      "native",
      "--reasoning-effort",
      "high",
      "--add-dir",
      "/path with spaces",
      "--no-session-persistence",
    ]),
  ).toMatchObject({
    model: "x",
    resume: "native",
    planMode: true,
    permissionMode: "default",
    extraArgs: { "reasoning-effort": "high" },
    additionalDirectories: ["/path with spaces"],
    persistSession: false,
  });
  expect(() => queryOptions(["--foo", "a", "--foo", "b"])).toThrow("Duplicate");
});

it("queries metadata and previews/restores checkpoints without sending a user prompt", async () => {
  const f = fixture();
  f.control("init", "initialize");
  f.control("quota", "get_usage_info");
  f.control("preview", "rewind_files", {
    user_message_id: "anchor",
    dry_run: true,
  });
  f.control("apply", "rewind_files", {
    user_message_id: "anchor",
    dry_run: false,
  });
  await vi.waitFor(() => expect(f.frames).toHaveLength(4));
  expect(f.sdk.startDaemon).toHaveBeenCalledWith(
    expect.objectContaining({
      pathToQoderCLIExecutable: "/cli with spaces/qodercn",
      auth: { type: "qodercli" },
    }),
  );
  expect(f.sdk.query.mock.calls[0][0].options).toMatchObject({
    daemon: f.daemon,
    resume: "native-id",
  });
  expect(f.sdk.query.mock.calls[0][0].options.auth).toBeUndefined();
  expect(f.frames[1].response.response.usage.userQuota.percentage).toBe(25);
  expect(f.query.rewindFiles.mock.calls).toEqual([
    ["anchor", { dryRun: true }],
    ["anchor", { dryRun: false }],
  ]);
  f.input.end();
  await f.done;
  expect(f.daemon.stop).toHaveBeenCalledOnce();
});

it("roundtrips permission decisions, cancels pending approvals and reports control errors", async () => {
  const f = fixture();
  f.control("init", "initialize");
  await vi.waitFor(() => expect(f.frames).toHaveLength(1));
  const canUseTool = f.sdk.query.mock.calls[0][0].options.canUseTool;
  const controller = new AbortController();
  const decision = canUseTool(
    "Bash",
    { command: "pwd" },
    { toolUseID: "call-1", signal: controller.signal },
  );
  const request = f.frames.at(-1);
  expect(request.request.tool_use_id).toBe("call-1");
  f.send({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: request.request_id,
      response: { behavior: "allow", updatedInput: { command: "pwd" } },
    },
  });
  expect(await decision).toEqual({
    behavior: "allow",
    updatedInput: { command: "pwd" },
  });
  const cancelled = canUseTool(
    "Write",
    {},
    { toolUseID: "call-2", signal: controller.signal },
  );
  controller.abort();
  expect(await cancelled).toMatchObject({ behavior: "deny" });
  expect(f.frames.at(-1).type).toBe("control_cancel_request");
  f.control("mode", "set_permission_mode", { mode: "plan" });
  f.control("mode2", "set_permission_mode", { mode: "acceptEdits" });
  f.control("unsupported", "delete_everything");
  await vi.waitFor(() =>
    expect(f.frames.at(-1).response?.request_id).toBe("unsupported"),
  );
  expect(f.frames.at(-1).response.subtype).toBe("error");
  expect(f.query.setPlanMode.mock.calls).toEqual([[true], [false]]);
  expect(f.query.setPermissionMode).toHaveBeenCalledWith("acceptEdits");
  f.input.end();
  await f.done;
});

it("forwards follow-up and image content without stale daemon routing", async () => {
  const f = fixture();
  f.control("init", "initialize");
  await vi.waitFor(() => expect(f.frames).toHaveLength(1));
  const prompts = f.sdk.query.mock.calls[0][0].prompt;
  const image = {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "test" },
  };
  f.send({
    type: "user",
    uuid: "message-id",
    session_id: "stale",
    message: { role: "user", content: [image] },
  });
  expect((await prompts.next()).value).toEqual({
    type: "user",
    uuid: "message-id",
    message: { role: "user", content: [image] },
  });
  f.input.end();
  await f.done;
});
