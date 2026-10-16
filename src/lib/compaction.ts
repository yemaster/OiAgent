import type { Message, ToolEvent } from "./types";

export const isCompaction = (tool?: ToolEvent) =>
  tool?.name === "context_compaction";
export function compactionOutcome(tool: ToolEvent): string {
  const output = tool.output;
  return output && typeof output === "object" && "outcome" in output
    ? String(output.outcome)
    : tool.state;
}

/** Match lifecycle updates per Agent/subagent, without inventing progress. */
export function normalizeCompaction(messages: Message[]): Message[] {
  const output: Message[] = [];
  const active = new Map<string, Message>();
  const last = new Map<string, Message>();
  const identified = new Map<string, Message>();
  function settle(message: Message, outcome = "settled") {
    message.tool = {
      ...message.tool!,
      state: "completed",
      output: { outcome },
    };
  }
  messages.forEach((message, index) => {
    const scope = `${message.agentKind || "agent"}:${message.parentCallId || message.tool?.parentCallId || "root"}`;
    const pending = active.get(scope);
    if (!isCompaction(message.tool)) {
      if (
        ["user", "handoff"].includes(message.role) &&
        !message.parentCallId &&
        !message.tool?.parentCallId
      ) {
        for (const [key, entry] of active) {
          if (key.endsWith(":root")) {
            settle(entry, "interrupted");
            active.delete(key);
            last.delete(key);
          }
        }
      }
      if (
        message.tool?.callId &&
        ["completed", "failed"].includes(message.tool.state)
      ) {
        for (const [key, entry] of active) {
          if (key.endsWith(`:${message.tool.callId}`)) {
            settle(
              entry,
              message.tool.state === "failed" ? "interrupted" : "settled",
            );
            active.delete(key);
          }
        }
      }
      // Background notifications do not mean the main Agent has resumed.
      if (
        ["user", "assistant", "reasoning", "handoff"].includes(message.role) ||
        (message.tool && message.tool.name !== "task_notification")
      ) {
        if (pending)
          settle(pending, message.role === "user" ? "interrupted" : "settled");
        active.delete(scope);
        last.delete(scope);
      }
      output.push(message);
      return;
    }
    const tool = message.tool!;
    const outcome = compactionOutcome(tool);
    const identity = tool.callId ? `${scope}:${tool.callId}` : undefined;
    const existing = identity
      ? identified.get(identity)
      : pending || (outcome !== "running" ? last.get(scope) : undefined);
    // Idle/result events are only meaningful when a compaction is in flight.
    if (outcome === "settled" && !pending) return;
    if (existing) {
      const previous = compactionOutcome(existing.tool!);
      // Late starts/resets cannot undo an explicit completion or failure.
      if (
        ["completed", "failed"].includes(previous) &&
        ["running", "settled"].includes(outcome)
      )
        return;
      existing.tool = {
        ...existing.tool!,
        state: tool.state,
        output: tool.output,
      };
      if (outcome !== "running" && pending === existing) active.delete(scope);
      return;
    }
    if (outcome === "running" && pending) settle(pending);
    const normalized = {
      ...message,
      tool: {
        ...tool,
        callId: `compaction:${identity || `${scope}:${index}`}`,
      },
    };
    output.push(normalized);
    last.set(scope, normalized);
    if (identity) identified.set(identity, normalized);
    if (outcome === "running") active.set(scope, normalized);
  });
  return output;
}
