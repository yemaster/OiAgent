import type { Agent, Usage } from "./types";
export type WorkflowStep = {
  id: string;
  title: string;
  kind: "agent" | "approval" | "review" | "condition";
  prompt: string;
  agentId: string;
  permission: string;
  model: string;
  providerId: string | null;
  executionTimeoutMinutes?: number | null;
  maxRepairs: number;
  position?: { x: number; y: number };
};
export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  branch?: "true" | "false";
};
export type WorkflowDefinition = {
  defaultAgentId?: string;
  edges?: WorkflowEdge[] | null;
  maxParallel?: number;
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
      | "pending"
      | "running"
      | "approval"
      | "completed"
      | "failed"
      | "cancelled"
      | "skipped";
    branch?: boolean | null;
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
  condition: "条件分支",
};
export const stepStatuses = {
  pending: "未开始",
  running: "进行中",
  approval: "等待确认",
  completed: "已完成",
  failed: "需要处理",
  cancelled: "已取消",
  skipped: "已跳过",
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
    executionTimeoutMinutes: null,
    maxRepairs: 0,
  };
}
export function newWorkflow(
  agents: Agent[],
  preset?: "implement" | "audit" | "parallel" | "branch",
): WorkflowDefinition {
  const agent = agents.find((a) => a.available && !a.custom)?.id || "";
  const make = (
    kind: WorkflowStep["kind"],
    title: string,
    prompt: string,
    write = false,
  ) => ({
    ...newStep("", kind),
    title,
    prompt,
    permission: write ? "workspace-write" : "read-only",
  });
  if (preset === "parallel" || preset === "branch") {
    const inspect = make(
      "agent",
      "检查项目",
      "阅读项目说明和相关代码，报告当前情况与可核实的证据。不修改文件。",
    );
    const left = make(
      "agent",
      preset === "parallel" ? "审查实现" : "修复并验证",
      preset === "parallel"
        ? "审查实现的正确性和边界情况，列出具体文件、问题和证据。不修改文件。"
        : "根据检查发现修复问题，运行相关验证，报告修改文件和结果。",
      preset === "branch",
    );
    const right = make(
      "agent",
      preset === "parallel" ? "审查测试" : "确认现状",
      preset === "parallel"
        ? "检查测试覆盖及遗漏，报告具体证据，不修改文件。"
        : "核对无需修改的依据，报告现有实现满足要求的证据，不修改文件。",
    );
    const summary = make(
      "agent",
      "汇总结果",
      "汇总前置节点的发现、验证结果和遗留问题，区分事实与建议。不修改文件。",
    );
    const condition = make(
      "condition",
      "是否需要修改",
      "前序检查是否已发现需要修改代码才能解决的问题？",
    );
    const edge = (
      source: string,
      target: string,
      branch?: "true" | "false",
    ): WorkflowEdge => ({ id: crypto.randomUUID(), source, target, branch });
    return layoutGraph({
      id: "",
      revision: 0,
      name: preset === "parallel" ? "并行审查与汇总" : "按检查结果分支",
      goal: "",
      defaultAgentId: agent,
      maxParallel: 2,
      steps:
        preset === "parallel"
          ? [inspect, left, right, summary]
          : [inspect, condition, left, right, summary],
      edges: [
        ...(preset === "parallel"
          ? [edge(inspect.id, left.id), edge(inspect.id, right.id)]
          : [
              edge(inspect.id, condition.id),
              edge(condition.id, left.id, "true"),
              edge(condition.id, right.id, "false"),
            ]),
        edge(left.id, summary.id),
        edge(right.id, summary.id),
      ],
    });
  }
  return asGraph({
    defaultAgentId: agent,
    maxParallel: 2,
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
      : [newStep()],
  });
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
    if (step.kind !== "review" && step.maxRepairs !== 0)
      return "返工次数只用于 LLM 检查节点";
    if (
      step.kind === "agent" &&
      (!(step.agentId || value.defaultAgentId) ||
        !["read-only", "workspace-write"].includes(step.permission))
    )
      return `请检查第 ${index + 1} 步的 Agent 和权限`;
    if (
      step.executionTimeoutMinutes != null &&
      (!Number.isInteger(step.executionTimeoutMinutes) ||
        step.executionTimeoutMinutes < 1 ||
        step.executionTimeoutMinutes > 4294967295)
    )
      return "执行时限需为正整数（分钟），留空不限制";
    if (
      !Number.isInteger(step.maxRepairs) ||
      step.maxRepairs < 0 ||
      step.maxRepairs > 2
    )
      return "自动返工最多 2 次";
    if (
      value.edges == null &&
      step.kind === "review" &&
      (index === 0 ||
        (step.maxRepairs > 0 && value.steps[index - 1].kind !== "agent"))
    )
      return "LLM 检查需要前序结果，自动返工须紧跟 Agent 步骤";
  }
  return value.edges != null ? validateGraph(value) : "";
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

/** Missing edges denotes an older, sequential definition. Never reinterpret an explicit empty graph. */
export function asGraph(value: WorkflowDefinition): WorkflowDefinition {
  if (value.edges != null) return value;
  return {
    ...value,
    edges: value.steps.slice(1).map((step, i) => ({
      id: crypto.randomUUID(),
      source: value.steps[i].id,
      target: step.id,
    })),
  };
}
export function repairSource(value: WorkflowDefinition, id: string) {
  const edges = value.edges ?? asGraph(value).edges!;
  const incoming = edges.filter((e) => e.target === id);
  if (incoming.length !== 1) return undefined;
  const source = value.steps.find((s) => s.id === incoming[0].source);
  return source?.kind === "agent" &&
    edges.filter((e) => e.source === source.id).length === 1
    ? source
    : undefined;
}
export function validateGraph(value: WorkflowDefinition): string {
  const edges = value.edges ?? [];
  const ids = new Set(value.steps.map((s) => s.id));
  const seen = new Set<string>();
  const edgeIds = new Set<string>();
  if (
    !Number.isInteger(value.maxParallel ?? 2) ||
    (value.maxParallel ?? 2) < 1 ||
    (value.maxParallel ?? 2) > 4
  )
    return "并行数需为 1–4";
  for (const edge of edges) {
    const key = `${edge.source}:${edge.target}:${edge.branch || ""}`;
    const source = value.steps.find((s) => s.id === edge.source);
    if (
      !edge.id ||
      edgeIds.has(edge.id) ||
      !ids.has(edge.source) ||
      !ids.has(edge.target) ||
      edge.source === edge.target ||
      seen.has(key)
    )
      return "连线无效或重复";
    if (
      source?.kind === "condition"
        ? !["true", "false"].includes(edge.branch || "")
        : !!edge.branch
    )
      return "请检查条件分支的连线";
    seen.add(key);
    edgeIds.add(edge.id);
  }
  const remaining = new Set(ids);
  while (remaining.size) {
    const ready = [...remaining].filter(
      (id) => !edges.some((e) => e.target === id && remaining.has(e.source)),
    );
    if (!ready.length) return "工作流不能包含循环连线";
    ready.forEach((id) => remaining.delete(id));
  }
  for (const step of value.steps) {
    if (
      step.kind === "condition" &&
      !["true", "false"].every((branch) =>
        edges.some((e) => e.source === step.id && e.branch === branch),
      )
    )
      return `“${step.title}”需要连接“是”和“否”两个分支`;
    if (
      step.kind === "review" &&
      (!edges.some((e) => e.target === step.id) ||
        (step.maxRepairs > 0 && !repairSource(value, step.id)))
    )
      return "LLM 检查需要前序结果，自动返工须紧跟 Agent，且该 Agent 不能连接其他节点";
  }
  return "";
}
export function layoutGraph(value: WorkflowDefinition): WorkflowDefinition {
  const levels = new Map<string, number>();
  for (let pass = 0; pass < value.steps.length; pass++) {
    for (const step of value.steps) {
      const parents = (value.edges ?? []).filter((e) => e.target === step.id);
      if (parents.every((e) => levels.has(e.source)))
        levels.set(
          step.id,
          Math.max(0, ...parents.map((e) => levels.get(e.source)! + 1)),
        );
    }
  }
  const rows = new Map<number, number>();
  return {
    ...value,
    steps: value.steps.map((step) => {
      const level = levels.get(step.id) ?? 0;
      const row = rows.get(level) ?? 0;
      rows.set(level, row + 1);
      return { ...step, position: { x: level * 280, y: row * 192 } };
    }),
  };
}
