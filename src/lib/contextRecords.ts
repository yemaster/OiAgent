import type { Message } from "./types";

/** Compatibility for persisted transcripts predating structured context records. */
export function normalizeContextRecords(messages: Message[]): Message[] {
  return messages.map((message) => {
    if (message.role !== "user" || message.tool || message.attachments?.length)
      return message;
    const text = message.text.trimStart();
    const compact =
      /^(?:This session is being continued from a previous conversation that ran out of context\.|The conversation so far has been summarized as follows:)/.test(
        text,
      );
    const skill = /^Base directory for this skill: ([^\r\n]+)\r?\n/.exec(text);
    if (!compact && !skill) return message;
    return {
      ...message,
      role: "tool",
      synthetic: true,
      text: "",
      tool: {
        callId: "",
        name: compact ? "context_compaction" : "skill_loaded",
        state: "completed",
        input: null,
        output: compact
          ? { outcome: "completed", summary: message.text }
          : { path: skill![1], content: message.text },
      },
    };
  });
}
export const isContextRecord = (name: string) =>
  name === "context_compaction" || name === "skill_loaded";
