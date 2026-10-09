export const agentCatalog: Record<
  string,
  {
    name: string;
    icon?: string;
    history: boolean;
    structured: boolean;
    resume: boolean;
    permissionLabel?: string;
  }
> = {
  codex: {
    name: "Codex",
    icon: "codex",
    history: true,
    structured: true,
    resume: true,
  },
  claude: {
    name: "Claude Code",
    icon: "claudecode-color",
    history: true,
    structured: true,
    resume: true,
  },
  qwen: {
    name: "Qwen Code",
    icon: "qwen-color",
    history: true,
    structured: true,
    resume: true,
  },
  gemini: {
    name: "Gemini CLI",
    icon: "geminicli-color",
    history: false,
    structured: true,
    resume: true,
  },
  opencode: {
    name: "OpenCode",
    icon: "opencode",
    history: false,
    structured: true,
    resume: true,
  },
  aider: {
    name: "Aider",
    history: false,
    structured: false,
    resume: false,
    permissionLabel: "问答模式（不编辑文件）",
  },
  goose: {
    name: "Goose",
    icon: "goose",
    history: false,
    structured: false,
    resume: false,
    permissionLabel: "对话模式（不执行工具）",
  },
};
