import { visibleUserText } from "./messageText";
import type { Message, ToolEvent } from "./types";

/** Compatibility for saved transcripts from before task events were normalized. */
function envelope(text: string): { tool: ToolEvent; rest: string } | null {
  const line = text.replace(/^[\r\n]+/, "");
  if (/^(?: {4}|\t)/.test(line) || text.length > 100_000) return null;
  const source = text.trimStart();
  if (!source.startsWith("<task-notification>")) return null;
  const close = "</task-notification>";
  const end = source.indexOf(close);
  if (end < 0) return null;
  const xml = source.slice(0, end + close.length);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return null;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  if (doc.querySelector("parsererror") || root.tagName !== "task-notification")
    return null;
  const fields: Record<string, string> = {};
  for (const node of root.childNodes) {
    if (node.nodeType === 3 && !node.textContent?.trim()) continue;
    if (node.nodeType !== 1) return null;
    const child = node as Element;
    if (child.attributes.length || child.children.length) return null;
    const key = child.tagName.replaceAll("-", "_");
    if (Object.hasOwn(fields, key)) return null;
    fields[key] = child.textContent?.trim() || "";
  }
  const id = fields.task_id;
  const status = fields.status;
  if (
    !id ||
    id.length > 512 ||
    ![
      "running",
      "in_progress",
      "started",
      "completed",
      "failed",
      "stopped",
    ].includes(status)
  )
    return null;
  return {
    rest: source.slice(end + close.length).replace(/^[\r\n]+/, ""),
    tool: {
      callId: `task-notification:${id}`,
      name: "task_notification",
      input: {
        taskId: id,
        status,
        description: fields.description,
        toolUseId: fields.tool_use_id,
      },
      output: {
        summary: fields.summary,
        result: fields.result,
        outputFile: fields.output_file,
      },
      state:
        status === "failed"
          ? "failed"
          : ["completed", "stopped"].includes(status)
            ? "completed"
            : "running",
      childIds: [id],
    },
  };
}

export function normalizeTaskNotifications(messages: Message[]): Message[] {
  // A replay can be split across chunks. Join it before attempting XML parsing.
  const joined: Message[] = [];
  for (const message of messages) {
    const previous = joined.at(-1);
    if (
      message.delta &&
      message.role === "user" &&
      previous?.role === "user" &&
      !message.tool &&
      !previous.tool &&
      message.parentCallId === previous.parentCallId &&
      message.agentKind === previous.agentKind &&
      message.synthetic === previous.synthetic
    ) {
      joined[joined.length - 1] = {
        ...previous,
        text: previous.text + message.text,
      };
    } else joined.push(message);
  }
  return joined.flatMap((message) => {
    if (
      message.role !== "user" ||
      message.tool ||
      message.synthetic === false ||
      (message.agentKind &&
        !["qodercn", "qoder", "claude"].includes(message.agentKind))
    )
      return [message];
    const result: Message[] = [];
    let rest = visibleUserText(message.text);
    let parsed = envelope(rest);
    if (!parsed) return [message];
    while (parsed) {
      result.push({
        ...message,
        role: "tool",
        text: "task_notification",
        tool: parsed.tool,
        delta: false,
      });
      rest = parsed.rest;
      parsed = envelope(rest);
    }
    if (rest.trim())
      result.push({ ...message, text: rest, delta: false, synthetic: false });
    return result;
  });
}
