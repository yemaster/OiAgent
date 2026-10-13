const extensions: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rs: "rust",
  sh: "bash",
  zsh: "bash",
  yml: "yaml",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  md: "markdown",
  vue: "xml",
  svelte: "xml",
  html: "xml",
  svg: "xml",
};
export function codeLanguage(file: string): string {
  const name = file.split(/[\\/]/).pop()?.toLowerCase() || "";
  if (name === "dockerfile") return "dockerfile";
  const ext = name.split(".").pop() || "";
  return extensions[ext] || ext;
}
