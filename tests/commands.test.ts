import { describe, it, expect } from "vitest";
import { parseCommands } from "@/lib/commands";
import { describeTool } from "@/lib/transcript";
describe("human-readable command extraction", () => {
  it("unwraps Agent orchestration into commands, preserving quotes and working directories", () => {
    const source = `await Promise.allSettled([tools.exec_command({cmd: "rg --files src", workdir: "/project"}), tools.exec_command({cmd: 'printf "hello\\n"', workdir: '/project two'})]);`;
    const result = parseCommands("functions.exec", source);
    expect(result.calls.map((c) => [c.command, c.cwd])).toEqual([
      ["rg --files src", "/project"],
      ['printf "hello\n"', "/project two"],
    ]);
    expect(result.wrapped).toBe(true);
    expect(
      describeTool({
        name: "functions.exec",
        input: source,
        callId: "1",
        state: "completed",
      }).code,
    ).not.toContain("Promise");
  });
  it("handles native argv envelopes without showing bash launch plumbing", () => {
    expect(
      parseCommands("shell", {
        command: ["/bin/zsh", "-lc", "git status --short"],
        cwd: "/work",
      }).calls[0],
    ).toMatchObject({ command: "git status --short", cwd: "/work" });
  });
  it("does not execute expressions or guess runtime-generated command arguments", () => {
    const result = parseCommands(
      "functions.exec",
      `await tools.exec_command({cmd: getSecret(), workdir: '/work'}); if (failed) await tools.exec_command({cmd: 'retry'});`,
    );
    expect(result.calls[0].command).toBeUndefined();
    expect(result.calls[1]).toMatchObject({ command: "retry", dynamic: true });
    expect(result.unresolved).toBe(true);
  });
});
