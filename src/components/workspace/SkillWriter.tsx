import { useEffect, useState } from "react";
import { LoaderCircle, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { call, desktop } from "@/lib/api";
import {
  skillReferences,
  type SkillWritingResult,
  type SkillWritingState,
} from "@/lib/skillWriter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Choice } from "./shared";

export function SkillWriter({
  state,
  content,
  name,
  kind,
  disabled,
  onState,
  onApply,
  onSettings,
}: {
  state: SkillWritingState;
  content: string;
  name: string;
  kind: string;
  disabled: boolean;
  onState: (patch: Partial<SkillWritingState>) => void;
  onApply: () => void;
  onSettings: () => void;
}) {
  const [config, setConfig] = useState<{
    configured: boolean;
    model: string;
  }>();
  const [configError, setConfigError] = useState("");
  useEffect(() => {
    let disposed = false;
    if (desktop)
      void call<{ configured: boolean; model: string }>("llm_status")
        .then((value) => {
          if (!disposed) setConfig(value);
        })
        .catch((e) => {
          if (!disposed) setConfigError(String(e));
        });
    return () => {
      disposed = true;
    };
  }, []);
  async function generate() {
    if (state.busy || !state.instruction?.trim()) return;
    const source = content;
    onState({ busy: true, error: "" });
    try {
      const result = await call<Omit<SkillWritingResult, "source">>(
        "write_skill",
        {
          input: {
            name,
            agentKind: kind,
            currentContent: source,
            instruction: state.instruction,
            referenceUrl: state.referenceUrl?.trim() || "",
          },
        },
      );
      onState({ result: { ...result, source }, editing: false, busy: false });
    } catch (e) {
      onState({ error: String(e), busy: false });
    }
  }
  if (!desktop)
    return (
      <div className="border-b px-4 py-3 text-sm text-muted-foreground">
        AI 帮写仅在桌面版可用。
      </div>
    );
  const stale = !!state.result && state.result.source !== content;
  const editing = !state.result || state.editing;
  return (
    <div
      aria-label="AI 编写 Skill"
      className="space-y-3 border-b bg-card px-4 py-3"
    >
      {config?.configured ? (
        <>
          {editing && (
            <>
              <div className="space-y-2">
                <Label htmlFor="skill-writing-instruction">编写要求</Label>
                <Textarea
                  id="skill-writing-instruction"
                  placeholder="描述用途、适用场景，或需要修改的内容…"
                  value={state.instruction || ""}
                  onChange={(e) => onState({ instruction: e.target.value })}
                  disabled={state.busy}
                  maxLength={8000}
                  className="max-h-36 min-h-20"
                />
              </div>
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  参考 Skill（可选）
                </summary>
                <div className="mt-3 space-y-3">
                  <Choice
                    label="参考 Skill"
                    value={
                      state.customReference
                        ? "custom"
                        : state.referenceUrl || ""
                    }
                    disabled={state.busy}
                    onChange={(value) =>
                      onState({
                        customReference: value === "custom",
                        referenceUrl: value === "custom" ? "" : value,
                      })
                    }
                    options={[
                      ...skillReferences,
                      { value: "custom", label: "GitHub 文件链接…" },
                    ]}
                    className="w-full"
                  />
                  {state.customReference && (
                    <Input
                      aria-label="参考 Skill 链接"
                      placeholder="https://github.com/…/blob/main/…/SKILL.md"
                      value={state.referenceUrl || ""}
                      onChange={(e) =>
                        onState({ referenceUrl: e.target.value })
                      }
                      disabled={state.busy}
                    />
                  )}
                  <div className="flex gap-3">
                    {[
                      { value: "anthropic", label: "Anthropic Skills ↗" },
                      { value: "openai", label: "OpenAI Skills ↗" },
                    ].map((source) => (
                      <Button
                        key={source.value}
                        variant="link"
                        size="xs"
                        className="h-auto p-0"
                        onClick={() =>
                          void call("open_skill_library", {
                            library: source.value,
                          }).catch((e) => toast.error(String(e)))
                        }
                      >
                        {source.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </details>
            </>
          )}
          {state.result && !editing && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">生成预览</span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onState({ editing: true })}
                >
                  调整要求
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onState({ result: null })}
                >
                  放弃
                </Button>
                <Button
                  size="sm"
                  disabled={stale || disabled || state.busy}
                  onClick={onApply}
                >
                  应用到编辑器
                </Button>
              </div>
            </div>
          )}
          {state.result?.reference && !editing && (
            <p
              className="truncate text-xs text-muted-foreground"
              title={state.result.reference.url}
            >
              参考：{state.result.reference.name}
            </p>
          )}
          {stale && (
            <p role="status" className="text-xs text-destructive">
              原文已修改，请重新生成。
            </p>
          )}
          {editing && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1">
                <span className="truncate text-xs text-muted-foreground">
                  {config.model}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="AI 帮写的 LLM API 设置"
                  onClick={onSettings}
                >
                  <Settings2 />
                </Button>
              </div>
              <Button
                size="sm"
                disabled={state.busy || disabled || !state.instruction?.trim()}
                onClick={() => void generate()}
              >
                {state.busy && <LoaderCircle className="animate-spin" />}
                {state.busy
                  ? "生成中…"
                  : state.result
                    ? "重新生成"
                    : "生成 Skill"}
              </Button>
            </div>
          )}
        </>
      ) : config ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            尚未配置 LLM API
          </span>
          <Button size="sm" variant="outline" onClick={onSettings}>
            配置 LLM API
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {configError || "正在读取 LLM 配置…"}
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      )}
    </div>
  );
}
