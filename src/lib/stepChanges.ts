import { editedFiles, type EditedFile } from "./editFiles";
import {
  decode,
  describeTool,
  record,
  type TranscriptItem,
} from "./transcript";
import type { ToolEvent } from "./types";

export interface StepChange extends EditedFile {
  id: string;
  step: string;
  timestamp: string;
  state: ToolEvent["state"];
  before?: string;
  after?: string;
  patch?: string;
  scope: "file" | "fragment" | "patch" | "unavailable";
  note?: string;
}
const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
const firstText = (...values: unknown[]) =>
  values.find((v) => typeof v === "string") as string | undefined;

function structuredPatch(value: unknown): string | undefined {
  if (!Array.isArray(value)) return;
  const hunks = value.map(record).filter((hunk) => Array.isArray(hunk.lines));
  if (!hunks.length) return;
  return hunks
    .map((hunk) =>
      [
        `@@ -${hunk.oldStart ?? "?"},${hunk.oldLines ?? "?"} +${hunk.newStart ?? "?"},${hunk.newLines ?? "?"} @@`,
        ...(hunk.lines as unknown[]).filter((line) => typeof line === "string"),
      ].join("\n"),
    )
    .join("\n");
}

/** Keep patch hunk boundaries intact. Missing context is not an empty file. */
function patchSections(value: unknown): Map<string, string> {
  const sections = new Map<string, string>();
  if (typeof value !== "string") return sections;
  let path = "";
  let lines: string[] = [];
  const flush = () => {
    if (path) sections.set(path, lines.join("\n"));
  };
  for (const line of value.split("\n")) {
    const header = /^\*\*\* (?:Update|Add|Delete) File: (.+)\r?$/.exec(line);
    if (header) {
      flush();
      path = header[1].replace(/\r$/, "");
      lines = [line];
    } else if (line.startsWith("*** Move to: ")) {
      path = line.slice(13).replace(/\r$/, "");
      lines.push(line);
    } else if (!line.startsWith("*** End Patch")) lines.push(line);
  }
  flush();
  return sections;
}

export function stepChanges(
  tool: ToolEvent,
  project: string,
  step = tool.callId,
  timestamp = "",
): StepChange[] {
  if (describeTool(tool).kind !== "edit") return [];
  const input = decode(tool.input);
  const args = record(input);
  const result = record(tool.fileResult);
  const output = record(tool.output);
  const patch =
    typeof input === "string"
      ? input
      : firstText(args.patch, args.patchText, args.patch_text, args.input);
  const sections = patchSections(patch);
  const files = editedFiles(tool, project);
  return files.flatMap((file, index): StepChange[] => {
    const row: StepChange = {
      ...file,
      id: `${step}:${index}:${file.path}`,
      step,
      timestamp,
      state: tool.state,
      scope: "unavailable",
    };
    const native = Array.isArray(args.changes)
      ? args.changes.map(record).find((change) => {
          const kind = record(change.kind);
          return (
            (kind.move_path ||
              change.move_path ||
              change.path ||
              change.file_path) === file.path
          );
        })
      : undefined;
    // Native per-file snapshots outrank partial replacement strings and patches.
    const detail =
      native || (files.length === 1 ? { ...output, ...result } : {});
    const original = record(detail.originalFile);
    row.before = firstText(
      detail.originalFile,
      original.content,
      detail.oldContent,
      detail.old_content,
      detail.before,
    );
    row.after = firstText(detail.newContent, detail.new_content, detail.after);
    if (
      files.length === 1 &&
      /^(write|write_file|writefile|create_file|createfile)$/i.test(
        tool.name.split(/[.:]/).at(-1) || "",
      )
    ) {
      row.after ??= text(args.content);
      if (
        detail.type === "create" ||
        detail.operation === "create" ||
        /create/i.test(tool.name)
      ) {
        row.operation = "add";
        row.before ??= "";
      }
    }
    if (row.operation === "delete") row.after = "";
    if (row.operation === "add" && row.after !== undefined) row.before ??= "";
    if (row.before !== undefined && row.after !== undefined) row.scope = "file";
    else {
      row.patch =
        firstText(native?.diff, detail.diff, detail.patch) ||
        structuredPatch(detail.structuredPatch) ||
        sections.get(file.path);
      if (row.patch) {
        // Add patches carry complete new content. Delete/update patches may only
        // carry a filename or a subset of lines; show the native patch as-is.
        const lines = row.patch.split("\n");
        if (
          file.operation === "add" &&
          sections.has(file.path) &&
          lines.slice(1).every((line) => line.startsWith("+") || line === "")
        ) {
          row.before = "";
          row.after = lines
            .slice(1)
            .filter((line) => line.startsWith("+"))
            .map((line) => line.slice(1))
            .join("\n");
          row.scope = "file";
        } else if (
          lines.some(
            (line) =>
              /^[ +\-]/.test(line) &&
              !line.startsWith("---") &&
              !line.startsWith("+++"),
          )
        )
          row.scope = "patch";
        else row.patch = undefined;
      }
      if (row.scope === "unavailable" && files.length === 1) {
        const edits = Array.isArray(args.edits)
          ? args.edits.map(record)
          : [args];
        const replacements = edits
          .map((edit) => ({
            before: firstText(edit.old_string, edit.old_str, edit.old_text),
            after: firstText(edit.new_string, edit.new_str, edit.new_text),
          }))
          .filter(
            (edit) => edit.before !== undefined && edit.after !== undefined,
          );
        if (replacements.length) {
          const changed = replacements.filter(
            (edit) => edit.before !== edit.after,
          );
          return changed.map((edit, i) => ({
            ...row,
            ...edit,
            id: `${row.id}:${i}`,
            scope: "fragment",
            note: [edit.before, edit.after].some((value) =>
              value?.includes("[内容过长，已截断]"),
            )
              ? "记录已截断"
              : edits.length > 1
                ? `片段 ${i + 1} / ${changed.length}`
                : args.replace_all
                  ? "全部匹配处"
                  : "修改片段",
          }));
        }
      }
    }
    if (
      row.operation === "edit" &&
      row.before !== undefined &&
      row.before === row.after
    )
      return [];
    const truncated = [row.before, row.after, row.patch].some((value) =>
      value?.includes("[内容过长，已截断]"),
    );
    if (truncated) row.note = "记录已截断";
    else if (row.scope === "unavailable")
      row.note =
        row.after !== undefined && row.operation !== "delete"
          ? "未记录修改前内容"
          : "此步骤未记录文件差异";
    return [row];
  });
}

/** Step identity includes its parent, so parallel subagents cannot collide. */
export function conversationChanges(
  items: TranscriptItem[],
  project: string,
  parent = "",
): StepChange[] {
  return items.flatMap((item) =>
    item.kind !== "tool"
      ? []
      : [
          ...stepChanges(
            item.tool,
            project,
            `${parent}/${item.key}`,
            item.timestamp,
          ),
          ...conversationChanges(item.nested, project, `${parent}/${item.key}`),
        ],
  );
}
