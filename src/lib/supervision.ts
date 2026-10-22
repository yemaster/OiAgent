export type SupervisionMode = "off" | "cautious" | "full";
export type SupervisionConfig = { mode: SupervisionMode; maxRetries: number };
export type SupervisionControl = SupervisionConfig & {
  retries: number;
  phase: string;
  lastStatus: string;
};
export const supervisionDefault: SupervisionConfig = {
  mode: "off",
  maxRetries: 2,
};
export const supervisionModes = [
  { value: "off", label: "关闭", description: "由你处理审批和继续任务" },
  {
    value: "cautious",
    label: "谨慎接管",
    description: "自动续办和检查，不确定时等待你",
  },
  {
    value: "full",
    label: "自动接管",
    description: "处理常规审批，检查结果并修补遗漏",
  },
] as const;
