const permissions: Record<string, { value: string; label: string }[]> = {
  codex: [
    { value: "read-only", label: "只读沙箱" },
    { value: "workspace-write", label: "项目目录可写" },
    { value: "danger-full-access", label: "完全访问（无文件沙箱）" },
  ],
  claude: [
    { value: "plan", label: "Plan · 只做计划" },
    { value: "default", label: "Default · 按需审批" },
    { value: "auto", label: "Auto · 自动审查操作" },
    { value: "acceptEdits", label: "Accept edits · 自动批准编辑" },
    { value: "dontAsk", label: "Don't ask · 拒绝未授权操作" },
    { value: "bypassPermissions", label: "Bypass · 跳过权限确认" },
  ],
  qwen: [
    { value: "plan", label: "Plan · 只做计划" },
    { value: "default", label: "Default · 按需审批" },
    { value: "auto-edit", label: "Auto edit · 自动批准编辑" },
    { value: "yolo", label: "YOLO · 自动批准全部工具" },
  ],
  gemini: [
    { value: "plan", label: "Plan · 只做计划" },
    { value: "default", label: "Default · 按需审批" },
    { value: "auto_edit", label: "Auto edit · 自动批准编辑" },
    { value: "yolo", label: "YOLO · 自动批准全部工具" },
  ],
  opencode: [
    { value: "plan", label: "Plan · 分析与计划" },
    { value: "build", label: "Build · 按程序配置执行" },
  ],
  aider: [
    { value: "ask", label: "Ask · 问答，不编辑" },
    { value: "code", label: "Code · 修改代码" },
    { value: "architect", label: "Architect · 设计后交给编辑模型" },
  ],
  goose: [
    { value: "chat", label: "Chat · 对话，不执行工具" },
    { value: "approve", label: "Approve · 工具执行前审批" },
    { value: "auto", label: "Auto · 自动执行工具" },
  ],
};
export function permissionOptions(kind: string) {
  return (
    permissions[kind] || [
      { value: "read-only", label: "只读分析 / 计划" },
      { value: "workspace-write", label: "允许修改项目" },
    ]
  );
}
export function normalizePermission(kind: string, value?: string) {
  const options = permissionOptions(kind);
  if (options.some((o) => o.value === value)) return value!;
  const writable: Record<string, string> = {
    claude: "acceptEdits",
    qwen: "auto-edit",
    gemini: "auto_edit",
    opencode: "build",
    aider: "code",
    goose: "approve",
  };
  return value === "workspace-write"
    ? writable[kind] || value
    : options[0].value;
}
export function parseLaunchOptions(argsText: string, envText: string) {
  const extraArgs = argsText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const env: Record<string, string> = {};
  for (const line of envText.split("\n")) {
    if (!line.trim()) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    if (index < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      throw new Error("环境变量请按每行 NAME=value 填写");
    env[key] = line.slice(index + 1);
  }
  return { extraArgs, env };
}
export interface TaskDraft {
  temporary?: boolean;
  temporaryPath?: string;
  deviceId?: string;
  providerId: string;
  mode: string;
  agent: string;
  dir: string;
  prompt: string;
  title: string;
  model: string;
  permission: string;
  command: string;
  maxTasks: string;
  resume: boolean;
  argsText: string;
  envText: string;
}
