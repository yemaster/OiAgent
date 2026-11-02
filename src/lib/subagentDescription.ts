import { visibleUserText } from "./messageText";
import type { Task } from "./types";

// Prefer human-facing explanations over protocol fields, verdicts and counters.
const textFields = [
  "summary",
  "rationale",
  "overall_explanation",
  "explanation",
  "description",
  "text",
  "content",
  "message",
  "answer",
  "result",
  "output",
  "response",
  "body",
  "detail",
  "reason",
  "error",
  "findings",
  "data",
  "payload",
  "title",
] as const;
const hiddenBlocks = new Set([
  "thinking",
  "reasoning",
  "redacted_thinking",
  "image",
  "image_url",
  "tool_use",
  "tool_call",
  "function_call",
  "custom_tool_call",
]);
const cache = new WeakMap<Task, string>();

function readable(source: string): string {
  let remaining = 160;
  function extract(value: unknown, depth: number): string {
    if (depth > 8 || --remaining < 0) return "";
    if (typeof value === "string") {
      const text = value.trim();
      if (!text || text.length > 65_536) return "";
      const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(text);
      const candidate = fenced?.[1].trim() || text;
      // Do not mistake ordinary text such as "[完成] 已检查" for JSON.
      const structured = /^(?:\{\s*(?:"|\}|$)|\[\s*(?:\{|"|\]|$))/.test(
        candidate,
      );
      if (["{", "[", '"'].includes(candidate[0]) || fenced) {
        try {
          return extract(JSON.parse(candidate), depth + 1);
        } catch {
          // Saved previews can end mid-JSON at the native 240-character limit.
          // Use the task's plain-language prompt instead of displaying a fragment.
          return structured || /^```json\b/i.test(text)
            ? ""
            : visibleUserText(text).trim();
        }
      }
      return visibleUserText(text).trim();
    }
    if (Array.isArray(value)) {
      const parts: string[] = [];
      for (const item of value) {
        if (remaining <= 0) break;
        const text = extract(item, depth + 1);
        if (text) parts.push(text);
      }
      return parts.join("\n");
    }
    if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      if (typeof object.type === "string" && hiddenBlocks.has(object.type))
        return "";
      for (const key of textFields) {
        if (!Object.hasOwn(object, key)) continue;
        if (
          (key === "data" || key === "payload") &&
          typeof object[key] !== "object"
        )
          continue;
        const text = extract(object[key], depth + 1);
        if (text) return text;
      }
    }
    return "";
  }
  return extract(source, 0);
}

/** Display compatibility for stored summaries; never mutate the conversation. */
export function subagentDescription(task: Task): string {
  const previous = cache.get(task);
  if (previous !== undefined) return previous;
  const description = readable(task.preview) || readable(task.prompt);
  cache.set(task, description);
  return description;
}
