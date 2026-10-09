import type { Agent, Usage } from "./types";
export type WorkflowStep = {
  id: string;
  title: string;
  kind: "agent" | "approval" | "review";
  prompt: string;
  agentId: string;
  permission: string;
  model: string;
  providerId: string | null;
  timeoutMinutes: number;
  maxRepairs: number;
};
export type WorkflowDefinition = {
  id: string;
  revision: number;
  name: string;
  goal: string;
  steps: WorkflowStep[];
};
export type WorkflowRun = {
  id: string;
  definition: WorkflowDefinition;
  project: string;
  status: "running" | "waiting" | "completed" | "cancelled";
  cursor: number;
  steps: {
    status:
      "pending" | "running" | "approval" | "completed" | "failed" | "cancelled";
    taskIds: string[];
    output: string;
    attempts: number;
    repairs: number;
    startedAt: string | null;
    finishedAt: string | null;
  }[];
  pauseRequested: boolean;
  error: string;
  feedback: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  llmUsage: Usage;
};
export type WorkflowEditor = {
  sessionId: string;
  definition: WorkflowDefinition;
  project: string;
};
export const stepNames = {
  agent: "Agent 任务",
  approval: "人工确认",
  review: "LLM 检查",
};
export const stepStatuses = {
  pending: "未开始",
  running: "进行中",
  approval: "等待确认",
  completed: "已完成",
  failed: "需要处理",
  cancelled: "已取消",
};
export function newStep(
  agentId = "",
  kind: WorkflowStep["kind"] = "agent",
): WorkflowStep {
  return {
    id: crypto.randomUUID(),
    title: stepNames[kind],
    kind,
    prompt: "",
    agentId,
    permission: "read-only",
    model: "",
    providerId: null,
    timeoutMinutes: 30,
    maxRepairs: 0,
  };
}
export function newWorkflow(
  agents: Agent[],
  preset?: "implement" | "audit",
): WorkflowDefinition {
  const agent = agents.find((a) => a.available && !a.custom)?.id || "";
  const make = (
    kind: WorkflowStep["kind"],
    title: string,
    prompt: string,
    write = false,
  ) => ({
    ...newStep(agent, kind),
    title,
    prompt,
    permission: write ? "workspace-write" : "read-only",
  });
  return {
    id: "",
    revision: 0,
    name:
      preset === "implement"
        ? "分析、实现与验证"
        : preset === "audit"
          ? "审查与修复"
          : "",
    goal: "",
    steps: preset
      ? [
          make(
            "agent",
            preset === "audit" ? "审查项目" : "分析需求",
            "阅读相关代码，列出问题、涉及的文件、修改方案与验收标准。此步骤不修改文件。",
          ),
          make(
            "approval",
            "确认方案",
            "检查前一步的方案和修改范围，确认后再继续；如需调整，请填写补充说明。",
          ),
          make(
            "agent",
            preset === "audit" ? "修复问题" : "实现并验证",
            "根据已确认的方案和用户补充完成修改。运行相关测试，报告变更文件、测试结果与遗留问题。",
            true,
          ),
          make(
            "review",
            "检查结果",
            "对照目标、确认的方案和测试结果判断是否完成；缺少验证证据时不得通过。列出需要返工的具体问题。",
          ),
        ]
      : [newStep(agent)],
  };
}
export function validateWorkflow(value: WorkflowDefinition) {
  if (!value.name.trim() || !value.goal.trim()) return "请填写工作流名称和目标";
  if (value.steps.length < 1 || value.steps.length > 24)
    return "工作流需要 1–24 个步骤";
  const ids = new Set<string>();
  for (const [index, step] of value.steps.entries()) {
    if (
      !step.id ||
      ids.has(step.id) ||
      !step.title.trim() ||
      !step.prompt.trim()
    )
      return `请补全第 ${index + 1} 步的名称和内容`;
    ids.add(step.id);
    if (!(step.kind in stepNames)) return "未知步骤类型";
    if (
      step.kind === "agent" &&
      (!step.agentId ||
        !["read-only", "workspace-write"].includes(step.permission))
    )
      return `请检查第 ${index + 1} 步的 Agent 和权限`;
    if (
      !Number.isInteger(step.timeoutMinutes) ||
      step.timeoutMinutes < 1 ||
      step.timeoutMinutes > 120
    )
      return "步骤限时为 1–120 分钟";
    if (
      !Number.isInteger(step.maxRepairs) ||
      step.maxRepairs < 0 ||
      step.maxRepairs > 2
    )
      return "自动返工最多 2 次";
    if (
      step.kind === "review" &&
      (index === 0 ||
        (step.maxRepairs > 0 && value.steps[index - 1].kind !== "agent"))
    )
      return "LLM 检查需要前序结果，自动返工须紧跟 Agent 步骤";
  }
  return "";
}
// Browser preview supports editing a separate local library, never executing agents.
export function browserWorkflows() {
  const raw = localStorage.getItem("oiagent-workflows");
  const definitions = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(definitions)) throw new Error("工作流数据无法读取");
  return { definitions: definitions as WorkflowDefinition[] };
}
export function changeBrowserWorkflow(
  command: string,
  args: Record<string, unknown>,
) {
  const { definitions } = browserWorkflows();
  if (command === "remove_workflow") {
    const current = definitions.find((d) => d.id === args.id);
    if (!current || current.revision !== args.revision)
      throw new Error("工作流已修改，请刷新后重试");
    localStorage.setItem(
      "oiagent-workflows",
      JSON.stringify(definitions.filter((d) => d.id !== args.id)),
    );
    return;
  }
  const definition = structuredClone(args.definition as WorkflowDefinition);
  const error = validateWorkflow(definition);
  if (error) throw new Error(error);
  if (!definition.id) {
    definition.id = crypto.randomUUID();
    definition.revision = 1;
    definitions.push(definition);
  } else {
    const index = definitions.findIndex((d) => d.id === definition.id);
    if (index < 0 || definitions[index].revision !== definition.revision)
      throw new Error("工作流已修改，请重新打开后编辑");
    definition.revision++;
    definitions[index] = definition;
  }
  localStorage.setItem("oiagent-workflows", JSON.stringify(definitions));
  return definition;
}
