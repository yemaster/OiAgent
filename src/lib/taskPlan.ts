import { describeTool, plain, record, type TranscriptItem } from "./transcript";

export function latestTaskPlan(timeline: TranscriptItem[]) {
  for (let i = timeline.length - 1; i >= 0; i--) {
    const item = timeline[i];
    if (item.kind !== "tool" || describeTool(item.tool).kind !== "plan")
      continue;
    const input = record(item.tool.input);
    const rows = input.plan || input.todos || input.items;
    if (Array.isArray(rows))
      return {
        key: item.key,
        rows: rows
          .map((value) => {
            const row = record(value);
            return {
              text: plain(row.step || row.content || row.text || value),
              done: row.status === "completed" || row.completed === true,
              running: row.status === "in_progress",
            };
          })
          .filter((row) => row.text),
      };
  }
  return { key: "", rows: [] };
}
