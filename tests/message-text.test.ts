import { describe, expect, it } from "vitest";
import { visibleUserText } from "@/lib/messageText";
import { buildTranscript } from "@/lib/transcript";

describe("message context", () => {
  const context =
    "<environment_context><cwd>/tmp/临时项目</cwd><shell>zsh</shell></environment_context>";
  it("omits injected context in cached and streamed messages without empty user bubbles", () => {
    const rows = buildTranscript([
      { role: "user", text: context, timestamp: "1" },
      { role: "user", text: context.slice(0, 20), timestamp: "2" },
      {
        role: "user",
        text: context.slice(20) + "\n修复搜索",
        timestamp: "2",
        delta: true,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "message",
      message: { text: "修复搜索" },
    });
  });
  it("preserves literal examples and incomplete XML", () => {
    for (const text of [
      `解释一下 ${context}`,
      `    ${context}`,
      `\t${context}`,
      `\`\`\`xml\n${context}\n\`\`\``,
      "<environment_context>unfinished",
    ])
      expect(visibleUserText(text)).toBe(text);
  });
});
