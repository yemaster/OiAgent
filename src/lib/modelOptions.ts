export type ModelOptions = {
  effort: string;
  serviceTier: string;
  contextWindow?: number;
};
export type AgentModel = {
  value: string;
  label: string;
  aliases?: string[];
  efforts?: string[];
  defaultEffort?: string;
  serviceTiers?: { value: string; label: string }[];
  contextWindows?: number[];
};
export type ModelCatalog = {
  models: AgentModel[];
  defaultModel: string;
  defaultEffort: string;
  defaultServiceTier: string;
};
export const emptyModelOptions: ModelOptions = { effort: "", serviceTier: "" };
/** Provider catalogs may return alphabetical or arbitrary ordering. */
export function orderedEfforts(values: string[]): string[] {
  const rank: Record<string, number> = {
    none: 0,
    disabled: 0,
    minimal: 1,
    low: 2,
    medium: 3,
    high: 4,
    xhigh: 5,
    ultra: 6,
    max: 100,
  };
  // Keep unfamiliar native values and their relative order; max remains last.
  return [...new Set(values)].sort((a, b) => (rank[a] ?? 99) - (rank[b] ?? 99));
}

export function supportsModelPicker(kind: string, custom?: boolean) {
  return (
    !custom &&
    [
      "codex",
      "claude",
      "qwen",
      "qodercn",
      "gemini",
      "opencode",
      "aider",
      "goose",
    ].includes(kind)
  );
}
function optionKey(
  kind: string,
  arg: string,
  next?: string,
): [keyof ModelOptions, string, boolean] | undefined {
  if (kind === "codex") {
    const paired = arg === "-c" || arg === "--config";
    const config = paired
      ? next
      : arg.startsWith("--config=")
        ? arg.slice(9)
        : arg.startsWith("-c")
          ? arg.slice(2)
          : undefined;
    const match = config?.match(
      /^\s*(model_reasoning_effort|service_tier)\s*=\s*(.*?)\s*$/,
    );
    if (match)
      return [
        match[1] === "service_tier" ? "serviceTier" : "effort",
        match[2].replace(/^["']|["']$/g, ""),
        paired,
      ];
  }
  if (kind === "qodercn") {
    const [flag, inline] = arg.split("=", 2);
    if (flag === "--reasoning-effort" || flag === "--context-window")
      return [
        flag === "--reasoning-effort" ? "effort" : "contextWindow",
        inline ?? next ?? "",
        inline === undefined,
      ];
  }
}
export function readModelOptions(
  kind: string,
  args: string[] = [],
): ModelOptions {
  const result: ModelOptions = { ...emptyModelOptions };
  for (let i = 0; i < args.length; i++) {
    const parsed = optionKey(kind, args[i], args[i + 1]);
    if (!parsed) continue;
    const [key, value, paired] = parsed;
    if (key === "contextWindow")
      result.contextWindow = Number(value) || undefined;
    else result[key] = value;
    if (paired) i++;
  }
  return result;
}
/** Keep advanced flags, replace only the options owned by the model picker. */
export function applyModelOptions(
  kind: string,
  args: string[],
  options: ModelOptions,
) {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const parsed = optionKey(kind, args[i], args[i + 1]);
    if (parsed) {
      if (parsed[2]) i++;
    } else result.push(args[i]);
  }
  if (kind === "codex") {
    if (options.effort)
      result.push(
        "-c",
        `model_reasoning_effort=${JSON.stringify(options.effort)}`,
      );
    if (options.serviceTier)
      result.push("-c", `service_tier=${JSON.stringify(options.serviceTier)}`);
  } else if (kind === "qodercn") {
    if (options.effort) result.push("--reasoning-effort", options.effort);
    if (options.contextWindow)
      result.push("--context-window", String(options.contextWindow));
  }
  return result;
}
