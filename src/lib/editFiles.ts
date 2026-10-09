import { decode, record } from "./transcript";
import type { ToolEvent } from "./types";

export type OpenProjectFile = (
  project: string,
  path: string,
  mode?: "edit" | "diff",
  originalPath?: string,
) => void;
export interface EditedFile {
  path: string;
  relativePath?: string;
  originalPath?: string;
  operation: "edit" | "add" | "delete" | "rename";
}

// Tool paths are untrusted. The backend additionally enforces containment and symlink checks.
export function projectRelativePath(
  project: string,
  path: string,
): string | undefined {
  const root = project.replace(/\\/g, "/").replace(/\/+$/, "");
  let value = path.replace(/\\/g, "/");
  if (!value || /[\x00-\x1f]/.test(value) || value.startsWith("~")) return;
  if (value.startsWith("/") || /^[a-z]:\//i.test(value)) {
    if (!value.startsWith(`${root}/`)) return;
    value = value.slice(root.length + 1);
  }
  const parts = value.split("/").filter((p) => p && p !== ".");
  if (
    !parts.length ||
    parts.some((p) => p === ".." || p === ".git" || p.includes(":"))
  )
    return;
  return parts.join("/");
}

export function editedFiles(tool: ToolEvent, project: string): EditedFile[] {
  const input = decode(tool.input);
  const args = record(input);
  const found: EditedFile[] = [];
  function add(path: unknown, kind: unknown = "edit", from?: unknown) {
    if (typeof path !== "string" || !path) return;
    const operation = /delete|remove/i.test(String(kind))
      ? "delete"
      : /add|create|new/i.test(String(kind))
        ? "add"
        : "edit";
    const originalPath =
      typeof from === "string" ? projectRelativePath(project, from) : undefined;
    found.push({
      path,
      relativePath:
        typeof from === "string" && !originalPath
          ? undefined
          : projectRelativePath(project, path),
      originalPath,
      operation: from ? "rename" : operation,
    });
  }
  const pathOf = (o: Record<string, unknown>) =>
    o.file_path || o.filePath || o.path || o.absolute_path || o.target_file;
  add(pathOf(args), args.kind || args.operation || tool.name);
  if (Array.isArray(args.changes)) {
    for (const change of args.changes) {
      const row = record(change);
      const kind = record(row.kind);
      add(
        kind.move_path || row.move_path || pathOf(row),
        kind.type || row.kind || row.type,
        kind.move_path || row.move_path ? pathOf(row) : row.original_path,
      );
    }
  }
  const patch = typeof input === "string" ? input : args.patch || args.input;
  if (typeof patch === "string") {
    let previous: EditedFile | undefined;
    for (const line of patch.split("\n")) {
      const match = /^\*\*\* (Update|Add|Delete) File: (.+)\r?$/.exec(line);
      if (match) {
        add(match[2].replace(/\r$/, ""), match[1]);
        previous = found.at(-1);
      } else if (previous && line.startsWith("*** Move to: ")) {
        const originalPath = previous.relativePath;
        previous.path = line.slice(13).replace(/\r$/, "");
        previous.relativePath = originalPath
          ? projectRelativePath(project, previous.path)
          : undefined;
        previous.originalPath = originalPath;
        previous.operation = "rename";
      }
    }
  }
  return [
    ...new Map(
      found.map((file) => [file.relativePath || file.path, file]),
    ).values(),
  ];
}
