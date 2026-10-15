import { useState } from "react";
import {
  Check,
  ChevronDown,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Choice } from "./shared";
import { useAgentModels } from "@/hooks/useAgentModels";
import {
  emptyModelOptions,
  orderedEfforts,
  type AgentModel,
  type ModelOptions,
} from "@/lib/modelOptions";
import type { Agent } from "@/lib/types";

const effortLabels: Record<string, string> = {
  none: "关闭",
  disabled: "关闭",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最大",
};
const effortLabel = (value: string) => effortLabels[value] || value;
const contextLabel = (value: number) =>
  value >= 1_000_000 ? `${value / 1_000_000}M` : `${value / 1000}K`;

function ModelSettingSlider({
  label,
  value,
  defaultValue,
  choices,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  defaultValue?: string;
  choices: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const effective = value || defaultValue || "";
  const known = choices.some((choice) => choice.value === defaultValue);
  const steps = known ? choices : [{ value: "", label: "默认" }, ...choices];
  const index = Math.max(
    0,
    steps.findIndex((choice) => choice.value === effective),
  );
  const current =
    steps.find((choice) => choice.value === effective)?.label ||
    effective ||
    "默认";
  return (
    <div>
      <div className="flex h-6 items-center gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="ml-auto font-medium">{current}</span>
        {!value && known && <span className="text-muted-foreground">默认</span>}
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={disabled || !value}
          aria-label={`恢复默认${label}`}
          title="恢复默认"
          onClick={() => onChange("")}
        >
          <RotateCcw className="size-3" />
        </Button>
      </div>
      <Slider
        aria-label={label}
        aria-valuetext={`${current}${!value && known ? "（默认）" : ""}`}
        value={[index]}
        min={0}
        max={Math.max(1, steps.length - 1)}
        step={1}
        disabled={disabled || steps.length < 2}
        onValueChange={([next]) => {
          if (steps[next]) onChange(steps[next].value);
        }}
      />
      <div
        aria-hidden="true"
        className="flex justify-between text-[10px] leading-4 text-muted-foreground"
      >
        <span>{steps[0]?.label}</span>
        <span>{steps.at(-1)?.label}</span>
      </div>
    </div>
  );
}

export function ModelPicker({
  agent,
  project,
  model,
  onModel,
  options,
  onOptions,
  provider,
  onProvider,
  profiles = [],
  disabled,
  remote,
  active = true,
  open: controlledOpen,
  onOpenChange,
  runtimeModels = [],
  nextTurn = false,
}: {
  agent: Agent;
  project: string;
  model: string;
  onModel: (value: string) => void | Promise<unknown>;
  options: ModelOptions;
  onOptions: (options: ModelOptions) => void;
  provider: string;
  onProvider: (value: string) => void;
  profiles?: { id: string; name: string }[];
  disabled?: boolean;
  remote?: boolean;
  active?: boolean;
  open?: boolean;
  onOpenChange?: (value: boolean) => void;
  runtimeModels?: AgentModel[];
  nextTurn?: boolean;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState(false);
  const [customModel, setCustomModel] = useState("");
  const claude = agent.kind === "claude";
  const { catalog, error, loading, refresh } = useAgentModels(
    agent,
    project,
    active && !remote && !claude,
  );
  const models = catalog.models.length ? catalog.models : runtimeModels;
  const actualModel = model || catalog.defaultModel;
  const selected = models.find(
    (m) =>
      m.value === actualModel ||
      m.label === actualModel ||
      m.aliases?.includes(actualModel),
  );
  const defaultEffort =
    (agent.kind === "codex" || !model ? catalog.defaultEffort : "") ||
    selected?.defaultEffort;
  const effort = options.effort || defaultEffort;
  const speed = options.serviceTier || catalog.defaultServiceTier;
  const fast = ["fast", "priority"].includes(speed);
  const label = claude
    ? provider === "local"
      ? "本机 API"
      : profiles.find((p) => p.id === provider)?.name || "API 配置已移除"
    : selected?.label || actualModel || "默认模型";
  const filtered = models.filter((m) =>
    `${m.label} ${m.value}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  async function select(value: string) {
    if (disabled) return;
    const ok = await onModel(value);
    if (ok === false) return;
    // A new model must not inherit unsupported effort/speed/context from the old one.
    if (value !== model) {
      const next = models.find((m) => m.value === value);
      onOptions({
        ...emptyModelOptions,
        effort: next?.defaultEffort || "",
        // Explicitly disable inherited Fast when this model doesn't advertise it.
        serviceTier:
          agent.kind === "codex" &&
          value &&
          !next?.serviceTiers?.length &&
          !!(catalog.defaultServiceTier || options.serviceTier)
            ? "default"
            : "",
      });
    }
    setManual(false);
  }
  if (claude && remote)
    return (
      <span className="px-2 text-xs text-muted-foreground">设备 API 配置</span>
    );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-7 min-w-0 max-w-64 shrink gap-1.5 text-xs text-muted-foreground"
          aria-label={claude ? "API 配置" : "选择模型"}
          title={`${label}${effort && !claude ? ` · ${effortLabel(effort)}` : ""}${nextTurn ? " · 下轮使用" : ""}`}
        >
          <span className="truncate">{label}</span>
          {!claude && effort && (
            <span className="shrink-0 opacity-70">{effortLabel(effort)}</span>
          )}
          {!claude && fast && (
            <Zap className="size-3 shrink-0" aria-label="Fast" />
          )}
          <ChevronDown className="size-3 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-72 max-w-[calc(100vw-2rem)] space-y-2 p-2.5"
      >
        <div className="flex items-center justify-between">
          <span className="pl-1 text-xs font-medium">
            {claude ? "API 配置" : "模型"}
          </span>
          {!claude && !remote && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="刷新模型列表"
              disabled={loading}
              onClick={refresh}
            >
              {loading ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
            </Button>
          )}
        </div>
        {claude ? (
          <div
            className="grid gap-0.5"
            role="group"
            aria-label="Claude Code API 配置"
          >
            {[{ id: "local", name: "本机 API 配置" }, ...profiles].map((p) => (
              <Button
                key={p.id}
                variant="ghost"
                className="h-7 justify-start text-xs font-normal"
                aria-pressed={provider === p.id}
                onClick={() => {
                  onProvider(p.id);
                  setOpen(false);
                }}
              >
                <span className="truncate">{p.name}</span>
                {provider === p.id && (
                  <Check className="ml-auto size-3.5 shrink-0" />
                )}
              </Button>
            ))}
          </div>
        ) : (
          <>
            {models.length > 6 && (
              <Input
                aria-label="搜索模型"
                placeholder="搜索模型"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8"
              />
            )}
            <div
              className="max-h-40 overflow-y-auto"
              role="group"
              aria-label="可用模型"
            >
              <Button
                variant="ghost"
                className="h-7 w-full justify-start text-xs font-normal"
                aria-pressed={!model}
                onClick={() => void select("")}
              >
                沿用程序配置{!model && <Check className="ml-auto size-3.5" />}
              </Button>
              {filtered.map((m) => (
                <Button
                  key={m.value}
                  variant="ghost"
                  className="h-7 w-full justify-start text-xs font-normal"
                  aria-pressed={model === m.value}
                  onClick={() => void select(m.value)}
                >
                  <span className="truncate">{m.label}</span>
                  {model === m.value && (
                    <Check className="ml-auto size-3.5 shrink-0" />
                  )}
                </Button>
              ))}
              {query && !filtered.length && (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  没有匹配的模型
                </p>
              )}
            </div>
            {error && (
              <p role="status" className="text-xs text-muted-foreground">
                {error}
              </p>
            )}
            {!loading && !error && !models.length && (
              <p className="text-xs text-muted-foreground">
                当前程序未提供模型列表，可手动填写。
              </p>
            )}
            {!remote &&
              selected &&
              (!!selected.efforts?.length ||
                !!selected.serviceTiers?.length ||
                (selected.contextWindows?.length || 0) > 1) && (
                <div className="grid gap-2 border-t pt-2">
                  {!!selected.efforts?.length && (
                    <ModelSettingSlider
                      label="思考深度"
                      value={options.effort}
                      defaultValue={defaultEffort}
                      choices={orderedEfforts(selected.efforts).map((v) => ({
                        value: v,
                        label: effortLabel(v),
                      }))}
                      disabled={disabled}
                      onChange={(effort) => onOptions({ ...options, effort })}
                    />
                  )}
                  {!!selected.serviceTiers?.length && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs">速度</span>
                      <Choice
                        label="模型速度"
                        value={options.serviceTier || "inherit"}
                        onChange={(v) =>
                          onOptions({
                            ...options,
                            serviceTier: v === "inherit" ? "" : v,
                          })
                        }
                        options={[
                          { value: "inherit", label: "沿用程序配置" },
                          { value: "default", label: "标准" },
                          ...selected.serviceTiers.filter(
                            (s) => s.value !== "default",
                          ),
                        ]}
                        className="h-8 text-xs"
                      />
                    </div>
                  )}
                  {(selected.contextWindows?.length || 0) > 1 && (
                    <ModelSettingSlider
                      label="上下文窗口"
                      value={
                        options.contextWindow
                          ? String(options.contextWindow)
                          : ""
                      }
                      choices={[...new Set(selected.contextWindows!)]
                        .sort((a, b) => a - b)
                        .map((n) => ({
                          value: String(n),
                          label: contextLabel(n),
                        }))}
                      disabled={disabled}
                      onChange={(value) =>
                        onOptions({
                          ...options,
                          contextWindow: value ? Number(value) : undefined,
                        })
                      }
                    />
                  )}
                </div>
              )}
            <div className="border-t pt-2">
              {manual ? (
                <div className="flex gap-2">
                  <Input
                    aria-label="模型名称"
                    placeholder="输入模型 ID"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    className="h-8"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        if (customModel.trim()) void select(customModel.trim());
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!customModel.trim()}
                    onClick={() => void select(customModel.trim())}
                  >
                    确定
                  </Button>
                </div>
              ) : (
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => {
                    setCustomModel(model);
                    setManual(true);
                  }}
                >
                  手动填写
                </Button>
              )}
            </div>
          </>
        )}
        {nextTurn && <p className="text-xs text-muted-foreground">下轮使用</p>}
      </PopoverContent>
    </Popover>
  );
}
