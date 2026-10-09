export const integrationKinds = [
  "codex",
  "claude",
  "qwen",
  "gemini",
  "opencode",
];
export const emptyRevision =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
export interface McpServer {
  name: string;
  config: Record<string, unknown>;
}
export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  path: string;
  revision: string;
  content: string;
}
export interface IntegrationView {
  configPath: string;
  skillsPath: string;
  revision: string;
  servers: McpServer[];
  skills: SkillEntry[];
  warnings: string[];
}
export function mcpTemplate(
  kind: string,
  remote: boolean,
): Record<string, unknown> {
  if (kind === "opencode")
    return remote
      ? { type: "remote", url: "", enabled: true }
      : {
          type: "local",
          command: [""],
          enabled: true,
        };
  if (remote)
    return {
      [kind === "gemini" || kind === "qwen" ? "httpUrl" : "url"]: "",
      ...(kind === "claude" ? { type: "http" } : {}),
    };
  return { command: "", args: [] };
}
