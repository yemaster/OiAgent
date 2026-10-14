import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildTranscript } from "@/lib/transcript";
import type { Message } from "@/lib/types";
import { Transcript } from "@/components/workspace/Transcript";
import { demoSnapshot } from "@/lib/demo";

const xml =
  "<task-notification><task-id>child-1</task-id><status>completed</status><summary>检查 &amp; 修复 &#x6587;件</summary><result><![CDATA[测试通过]]></result><output-file>src/main.ts</output-file></task-notification>";
const replay = (text = xml, extra: Partial<Message> = {}): Message => ({
  role: "user",
  text,
  timestamp: "now",
  agentKind: "qodercn",
  ...extra,
});

describe("background task notifications", () => {
  it("parses cached and split replays without displaying XML as a user prompt", () => {
    for (const messages of [
      [replay()],
      [replay(xml.slice(0, 50)), replay(xml.slice(50), { delta: true })],
    ]) {
      expect(buildTranscript(messages)).toMatchObject([
        {
          kind: "tool",
          tool: {
            name: "task_notification",
            state: "completed",
            output: { summary: "检查 & 修复 文件", result: "测试通过" },
          },
        },
      ]);
    }
  });
  it("joins native lifecycle and replay events and ignores late progress", () => {
    const progress: Message = {
      role: "tool",
      text: "task_notification",
      timestamp: "start",
      tool: {
        callId: "task-notification:child-1",
        name: "task_notification",
        input: { status: "running", description: "检查代码" },
        output: { usage: { total_tokens: 12 } },
        state: "running",
      },
    };
    const rows = buildTranscript([progress, replay(), progress]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "tool",
      tool: {
        state: "completed",
        input: { status: "completed", description: "检查代码" },
        output: { summary: "检查 & 修复 文件", usage: { total_tokens: 12 } },
      },
    });
  });
  it("preserves explicit human messages, examples, malformed and unknown XML", () => {
    for (const text of [
      `解释 ${xml}`,
      `\`\`\`xml\n${xml}\n\`\`\``,
      `    ${xml}`,
      xml.replace("</status>", "</broken>"),
      xml.replace("completed", "future-status"),
      xml.replace("</task-notification>", ""),
    ]) {
      expect(buildTranscript([replay(text)])[0]).toMatchObject({
        kind: "message",
        message: { text },
      });
    }
    expect(buildTranscript([replay(xml, { synthetic: false })])[0].kind).toBe(
      "message",
    );
    expect(
      buildTranscript([replay(xml, { agentKind: "custom" })])[0].kind,
    ).toBe("message");
  });
  it("preserves trailing text and parent task attribution", () => {
    const rows = buildTranscript([
      replay(xml + "\n继续修复", { parentCallId: "parent" }),
    ]);
    expect(rows[0]).toMatchObject({
      kind: "tool",
      nested: [
        { kind: "tool", tool: { name: "task_notification" } },
        { kind: "message", message: { text: "继续修复" } },
      ],
    });
  });
  it("shows a concise collapsed status card with safe file navigation and copying", async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    const view = render(
      <Transcript
        items={buildTranscript([replay()])}
        task={demoSnapshot.tasks[4]}
        childTasks={[]}
        onOpen={vi.fn()}
        onOpenFile={onOpenFile}
      />,
    );
    const disclosure = view.container.querySelector(
      "details.group\\/notification",
    )!;
    expect(disclosure).not.toHaveAttribute("open");
    expect(screen.getByText("后台任务")).toBeVisible();
    expect(screen.getByText("已完成")).toBeVisible();
    expect(screen.getByText("检查 & 修复 文件")).toBeVisible();
    expect(view.container.textContent).not.toContain("<task-notification>");
    await user.click(disclosure.querySelector("summary")!);
    expect(screen.getByText("测试通过")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "src/main.ts" }));
    expect(onOpenFile).toHaveBeenCalledWith(
      demoSnapshot.tasks[4].project,
      "src/main.ts",
      "edit",
      undefined,
      undefined,
    );
    await user.click(screen.getByRole("button", { name: "复制任务结果" }));
    expect(await navigator.clipboard.readText()).toBe("测试通过");
  });
  it("labels stopped tasks without reporting successful completion", () => {
    render(
      <Transcript
        items={buildTranscript([replay(xml.replace("completed", "stopped"))])}
        task={demoSnapshot.tasks[4]}
        childTasks={[]}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText("已停止")).toBeVisible();
  });
});
