import { expect, it } from "vitest";
import { buildTranscript } from "@/lib/transcript";
import { sessionCommands, sessionServices } from "@/lib/sessionActivity";
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
  expect(sessionServices(commands)).toEqual([
    expect.objectContaining({
      host: "localhost",
      port: 5173,
      url: "http://localhost:5173/",
      local: true,
    }),
  ]);
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
  expect(sessionServices(commands)[0]).toMatchObject({
    host: "0.0.0.0",
    port: 8000,
    url: "http://localhost:8000/",
  });
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
