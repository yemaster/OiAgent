export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
  symlink: boolean;
}
export interface Directory {
  entries: FileEntry[];
  truncated: boolean;
}
export interface FileContent {
  content: string;
  revision: string;
}
export interface Change {
  path: string;
  originalPath?: string | null;
  status: string;
  taskTouched: boolean;
}
export interface Changes {
  git: boolean;
  files: Change[];
  truncated: boolean;
}
export interface FileDiff {
  original: string;
  modified: string;
  originalLabel: string;
}
export interface OpenFile {
  instruction?: import("@/pages/Instructions").InstructionTarget;
  skill?: import("./integrations").SkillTarget;
  id: string;
  project: string;
  path: string;
  mode: "edit" | "diff";
  content: string;
  saved: string;
  revision: string;
  original?: string;
  originalLabel?: string;
  originalPath?: string;
  loading: boolean;
  saving: boolean;
  error?: string;
  conflict?: FileContent;
}
export const fileId = (project: string, path: string, mode: string) =>
  `${mode}:${encodeURIComponent(project)}:${encodeURIComponent(path)}`;
export const dirtyFile = (file: OpenFile) =>
  file.mode === "edit" && file.content !== file.saved;
export function language(path: string) {
  const name = path.split("/").at(-1)!.toLowerCase();
  if (name === "dockerfile") return "dockerfile";
  const ext = name.split(".").at(-1)!;
  return (
    (
      {
        ts: "typescript",
        tsx: "typescript",
        js: "javascript",
        jsx: "javascript",
        mjs: "javascript",
        cjs: "javascript",
        json: "json",
        jsonc: "json",
        css: "css",
        scss: "scss",
        html: "html",
        vue: "html",
        md: "markdown",
        mdx: "markdown",
        py: "python",
        rs: "rust",
        go: "go",
        java: "java",
        kt: "kotlin",
        c: "c",
        h: "c",
        cpp: "cpp",
        hpp: "cpp",
        sh: "shell",
        zsh: "shell",
        bash: "shell",
        yml: "yaml",
        yaml: "yaml",
        toml: "ini",
        ini: "ini",
        sql: "sql",
        xml: "xml",
        svg: "xml",
        txt: "plaintext",
      } as Record<string, string>
    )[ext] || "plaintext"
  );
}
export const changeLabel = (status: string) =>
  status === "??"
    ? "新增"
    : status.includes("U")
      ? "冲突"
      : status.includes("R")
        ? "重命名"
        : status.includes("D")
          ? "删除"
          : status.includes("A")
            ? "新增"
            : "修改";

export function readOpenFile(
  file: Pick<OpenFile, "instruction" | "project" | "path">,
) {
  return file.instruction
    ? {
        command: "read_instruction",
        args: { scope: file.instruction.scope, id: file.instruction.id },
      }
    : {
        command: "read_project_file",
        args: { project: file.project, path: file.path },
      };
}
