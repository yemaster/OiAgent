import { expect, it } from "vitest";
import { buildTranscript } from "@/lib/transcript";
import {
  sessionCommands,
  sessionServices,
  configuredServices,
  serviceVisitUrl,
} from "@/lib/sessionActivity";
import type { Message, ToolEvent } from "@/lib/types";
function event(
  id: string,
  name: string,
  input: unknown,
  output: unknown,
  state: ToolEvent["state"] = "completed",
  parentCallId?: string,
): Message {
  return {
    role: "tool",
    text: "",
    timestamp: "2026-10-15T12:00:00Z",
    parentCallId,
    tool: { callId: id, name, input, output, state },
  };
}
it("joins Codex process polling with the original command, output and exit code", () => {
  const items = buildTranscript([
    event(
      "start",
      "functions.exec_command",
      { cmd: "npm run dev", workdir: "/project" },
      {
        output: "\u001b[32mLocal: http://localhost:5173/\u001b[0m",
        session_id: 12,
        exit_code: null,
      },
    ),
    event(
      "poll",
      "functions.write_stdin",
      { session_id: 12 },
      { output: "server stopped", exit_code: 1 },
    ),
  ]);
  const commands = sessionCommands(items, true);
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({
    command: "npm run dev",
    cwd: "/project",
    state: "failed",
    exitCode: 1,
    background: true,
  });
  expect(commands[0].output).toContain("server stopped");
  expect(commands[0].output).not.toContain("\u001b");
  expect(sessionServices(commands)).toEqual([]);
});
it("correlates Claude background log reads and Qoder task notifications", () => {
  const commands = sessionCommands(
    buildTranscript([
      event(
        "bash",
        "Bash",
        { command: "python -m http.server 8000", run_in_background: true },
        { task_id: "bg-1", output_file: "/tmp/bg.log" },
      ),
      event(
        "read",
        "Read",
        { file_path: "/tmp/bg.log" },
        "Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/)",
      ),
      event(
        "notice",
        "task_notification",
        { taskId: "bg-1", toolUseId: "bash", status: "completed" },
        { summary: "Task completed" },
      ),
    ]),
    true,
  );
  expect(commands).toHaveLength(1);
  expect(commands[0].state).toBe("completed");
  expect(sessionServices(commands)).toEqual([]);
});
it("keeps nested agent process IDs separate and parses wrapper commands without executing code", () => {
  const commands = sessionCommands(
    buildTranscript([
      event(
        "outer",
        "functions.exec",
        'const r = await tools.exec_command({cmd:"npm test", workdir:"/project"}); text(r);',
        { output: "passed", exit_code: 0 },
      ),
      event(
        "a",
        "Bash",
        { command: "npm run dev" },
        { output: "Local: http://localhost:3000", session_id: 7 },
        "completed",
        "agent-a",
      ),
      event(
        "b",
        "Bash",
        { command: "npm run docs" },
        { output: "Local: http://localhost:4000", session_id: 7 },
        "completed",
        "agent-b",
      ),
      event(
        "poll",
        "write_stdin",
        { session_id: 7 },
        { output: "closed", exit_code: 0 },
        "completed",
        "agent-b",
      ),
    ]),
    true,
  );
  expect(commands.map((command) => command.command)).toEqual([
    "npm test",
    "npm run dev",
    "npm run docs",
  ]);
  expect(commands.map((command) => command.state)).toEqual([
    "completed",
    "running",
    "completed",
  ]);
  expect(
    sessionCommands(
      buildTranscript([
        event("c", "Bash", { command: "npm run dev" }, { session_id: 9 }),
      ]),
      false,
    )[0].state,
  ).toBe("unknown");
});
it("does not treat prompts, read files, arbitrary links or failed starts as services", () => {
  const messages = [
    {
      role: "assistant",
      text: "Server running at http://localhost:9000",
      timestamp: "",
    },
    event(
      "read",
      "Bash",
      { command: "cat README.md" },
      "Local: http://localhost:3000",
    ),
    event(
      "curl",
      "Bash",
      { command: "curl http://localhost:4000" },
      "Local: http://localhost:4000",
    ),
    event(
      "fail",
      "Bash",
      { command: "npm run dev" },
      "Error: server failed at http://localhost:5000",
    ),
    event(
      "test",
      "Bash",
      { command: "npm test" },
      "See https://example.org:9999/docs",
    ),
  ];
  expect(
    sessionServices(sessionCommands(buildTranscript(messages), false)),
  ).toEqual([]);
});
it("deduplicates endpoints, handles IPv6 and keeps unknown hosts explicit", () => {
  const commands = sessionCommands(
    buildTranscript([
      event(
        "a",
        "shell",
        { command: ["/bin/zsh", "-lc", "node server.js"] },
        "Listening on http://[::1]:8080/\nLocal: http://[::1]:8080/\nServer listening on port 9000",
      ),
    ]),
    true,
  );
  expect(commands[0].command).toBe("node server.js");
  expect(sessionServices(commands)).toEqual([
    expect.objectContaining({
      host: "::1",
      port: 8080,
      local: true,
      url: "http://[::1]:8080/",
    }),
    expect.objectContaining({ host: "未报告", port: 9000, local: false }),
  ]);
});

it("extracts explicit launch ports without treating configuration as a listening service", () => {
  const commands = sessionCommands(
    buildTranscript([
      event(
        "start",
        "functions.exec_command",
        {
          cmd: "cd /project && DEMO_FLAG='local fixture' DISABLE_RATE=1 PORT=8080 node server.js",
        },
        { session_id: 12, output: "", exit_code: null },
      ),
    ]),
    true,
  );
  expect(sessionServices(commands)).toEqual([]);
  expect(configuredServices(commands)).toEqual([
    expect.objectContaining({ host: "localhost", port: 8080, local: true }),
  ]);
  expect(configuredServices([{ ...commands[0], state: "completed" }])).toEqual(
    [],
  );
});
it("ignores quoted examples, dynamic ports, client commands and nonlocal hosts", () => {
  const inputs = [
    "echo 'PORT=8080 node server.js'",
    "PORT=8080 curl localhost:8080",
    "PORT=$PORT node server.js",
    "PORT=65536 node server.js",
    "PORT=0 node server.js",
    "HOST=example.org PORT=8080 node server.js",
    "node -e 'console.log(8080)'",
  ];
  const commands = sessionCommands(
    buildTranscript(
      inputs.map((command, i) =>
        event(String(i), "Bash", { command }, { session_id: i + 1 }),
      ),
    ),
    true,
  );
  expect(configuredServices(commands)).toEqual([]);
});
it("handles quoted assignments, env wrappers and common server flags", () => {
  const inputs = [
    "env PORT='8080' node server.js",
    "vite --host --port=5173",
    "uvicorn app:app --port 8000",
    "python -m http.server 9000",
  ];
  expect(
    configuredServices(
      sessionCommands(
        buildTranscript(
          inputs.map((command, i) =>
            event(String(i), "Bash", { command }, { session_id: i + 1 }),
          ),
        ),
        true,
      ),
    ).map((s) => s.port),
  ).toEqual([8080, 5173, 8000, 9000]);
});

it("opens detected local ports in a browser while preserving explicit HTTPS addresses", () => {
  const service = {
    id: "service",
    commandId: "server",
    command: "node server.js",
    host: "localhost",
    port: 8080,
    local: true,
  };
  expect(serviceVisitUrl(service)).toBe("http://localhost:8080/");
  expect(serviceVisitUrl({ ...service, host: "0.0.0.0" })).toBe(
    "http://localhost:8080/",
  );
  expect(serviceVisitUrl({ ...service, host: "::" })).toBe(
    "http://localhost:8080/",
  );
  expect(serviceVisitUrl({ ...service, host: "::1" })).toBe(
    "http://[::1]:8080/",
  );
  expect(
    serviceVisitUrl({ ...service, url: "https://localhost:8443/app" }),
  ).toBe("https://localhost:8443/app");
  expect(serviceVisitUrl({ ...service, url: "http://[::]:8080/" })).toBe(
    "http://localhost:8080/",
  );
  expect(
    serviceVisitUrl({ ...service, host: "未报告", local: false }),
  ).toBeUndefined();
  expect(serviceVisitUrl({ ...service, port: 70000 })).toBeUndefined();
  expect(
    serviceVisitUrl({ ...service, url: "javascript:alert(1)" }),
  ).toBeUndefined();
  expect(
    serviceVisitUrl({ ...service, url: "https://user:password@example.com/" }),
  ).toBeUndefined();
});

it.each(["killed", "cancelled", "terminated", "completed"])(
  "removes a background process and its port after a %s notification",
  (status) => {
    const commands = sessionCommands(
      buildTranscript([
        event(
          "start",
          "Bash",
          { command: "node server.js" },
          { task_id: "worker", output: "Local: http://localhost:8080" },
        ),
        event("notify", "task_notification", { taskId: "worker", status }, {}),
        event(
          "late",
          "TaskOutput",
          { task_id: "worker" },
          { task: { status: "running" } },
        ),
      ]),
      true,
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      state: status === "completed" ? "completed" : "stopped",
      ended: true,
    });
    expect(sessionServices(commands)).toEqual([]);
    expect(configuredServices(commands)).toEqual([]);
  },
);

it("does not mistake a failed poll or log prose for process termination", () => {
  const commands = sessionCommands(
    buildTranscript([
      event(
        "start",
        "Bash",
        { command: "node server.js" },
        { task_id: "worker", output_file: "/tmp/run.log" },
      ),
      event(
        "read",
        "Read",
        { file_path: "/tmp/run.log" },
        "Process exited with code 0",
      ),
      event(
        "poll",
        "TaskOutput",
        { task_id: "worker" },
        "Timed out waiting for output",
        "failed",
      ),
      event(
        "poll2",
        "TaskOutput",
        { task_id: "worker" },
        "The previous task had exit code 0",
      ),
    ]),
    true,
  );
  expect(commands[0]).toMatchObject({ state: "running" });
  expect(commands[0].ended).toBeFalsy();
});

it("reads nested TaskOutput lifecycle evidence and successful stop acknowledgements", () => {
  for (const stop of [
    event(
      "poll",
      "TaskOutput",
      { task_id: "worker" },
      { task: { status: "completed", exit_code: 1, output: "failed" } },
    ),
    event("stop", "TaskStop", { task_id: "worker" }, { success: true }),
  ]) {
    const commands = sessionCommands(
      buildTranscript([
        event(
          "start",
          "Bash",
          { command: "npm run dev" },
          { task_id: "worker" },
        ),
        stop,
      ]),
      true,
    );
    expect(commands[0].ended).toBe(true);
    expect(["failed", "stopped"]).toContain(commands[0].state);
  }
});

it("does not resurrect an unresolved old-turn process when a new turn starts", () => {
  const before = event(
    "start",
    "exec_command",
    { cmd: "PORT=8080 node server.js" },
    { session_id: 12 },
  );
  const user: Message = {
    role: "user",
    text: "continue",
    timestamp: "2026-10-15T12:01:00Z",
  };
  const commands = sessionCommands(buildTranscript([before, user]), true);
  expect(commands[0]).toMatchObject({ state: "unknown", stale: true });
  expect(configuredServices(commands)).toEqual([]);
  const polled = sessionCommands(
    buildTranscript([
      before,
      user,
      event(
        "poll",
        "write_stdin",
        { session_id: 12 },
        { session_id: 12, output: "" },
      ),
    ]),
    true,
  );
  expect(polled[0]).toMatchObject({ state: "running", stale: false });
});

it("distinguishes a pending tool invocation from confirmed running execution", () => {
  const items = buildTranscript([
    event("start", "Bash", { command: "npm test" }, undefined, "called"),
  ]);
  expect(sessionCommands(items, true)[0].state).toBe("pending");
  expect(sessionCommands(items, false)[0].state).toBe("unknown");
});

it("joins nested wrapper commands to later polls without duplicate process rows", () => {
  const commands = sessionCommands(
    buildTranscript([
      event(
        "wrapper",
        "functions.exec",
        'const result = await tools.exec_command({cmd:"npm run dev"}); text(result);',
        {},
      ),
      event(
        "child",
        "exec_command",
        { cmd: "npm run dev" },
        { session_id: 12 },
        "completed",
        "wrapper",
      ),
      event(
        "poll",
        "write_stdin",
        { session_id: 12 },
        { exit_code: 0, output: "closed" },
      ),
    ]),
    true,
  );
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({
    command: "npm run dev",
    state: "completed",
    ended: true,
  });
});

it("correlates the native Claude background launch banner with TaskOutput", () => {
  const commands = sessionCommands(
    buildTranscript([
      event(
        "launch",
        "Bash",
        { command: "node server.js" },
        "Command running in background with ID: bg123. Output is being written to: /tmp/bg123.output",
      ),
      event(
        "finish",
        "TaskOutput",
        { task_id: "bg123" },
        { task: { status: "completed", exit_code: 0 } },
      ),
    ]),
    true,
  );
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({
    state: "completed",
    ended: true,
    exitCode: 0,
  });
});
