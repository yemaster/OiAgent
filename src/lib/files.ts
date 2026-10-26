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
  image?: ImagePreview;
}
export interface ImagePreview {
  url: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
}
export const imageFile = (path: string) =>
  /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i.test(path);
export const vectorFile = (path: string) => /\.svg$/i.test(path);
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
export interface FileLocation {
  line: number;
  column?: number;
}
export interface OpenFile {
  location?: FileLocation;
  skillWriting?: import("./skillWriter").SkillWritingState;
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
  /** Metadata-only tab; content is read when it becomes visible. */
  unloaded?: boolean;
  saving: boolean;
  error?: string;
  conflict?: FileContent;
  image?: ImagePreview;
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
        command:
          imageFile(file.path) && !vectorFile(file.path)
            ? "read_project_image"
            : "read_project_file",
        args: { project: file.project, path: file.path },
      };
}
