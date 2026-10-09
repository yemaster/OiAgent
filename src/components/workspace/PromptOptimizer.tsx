import { useEffect, useRef, useState } from "react";
import { WandSparkles, LoaderCircle, Settings2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Choice } from "./shared";
import { call, desktop } from "@/lib/api";
import type { Usage } from "@/lib/types";
export function PromptOptimizer({
  prompt,
  onChange,
  onSettings,
}: {
  prompt: string;
  onChange: (v: string) => void;
  onSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<{
    configured: boolean;
    model?: string;
  }>();
  const [style, setStyle] = useState("clarity");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    prompt: string;
    source: string;
    usage: Usage;
  }>();
  const [undo, setUndo] = useState<{ before: string; after: string }>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    let stale = false;
    void call<{ configured: boolean; model?: string }>("llm_status")
      .then((v) => {
        if (!stale) {
          setConfig(v);
          setError("");
        }
      })
      .catch((e) => {
        if (!stale) setError(String(e));
      });
    return () => {
      stale = true;
    };
  }, [open]);
  async function optimize() {
    const source = prompt;
    setBusy(true);
    setError("");
    try {
      const next = await call<{ prompt: string; usage: Usage }>(
        "optimize_prompt",
        { prompt: source, style },
      );
      if (mounted.current) setResult({ ...next, source });
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className="flex items-center gap-1">
      {undo && prompt === undo.after && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="撤销 Prompt 优化"
          title="撤销 Prompt 优化"
          onClick={() => {
            onChange(undo.before);
            setUndo(undefined);
          }}
        >
          <Undo2 />
        </Button>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="优化 Prompt"
            title="优化 Prompt"
            className="text-muted-foreground"
          >
            {busy ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <WandSparkles />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          className="w-[min(420px,calc(100vw-32px))] max-h-[75vh] space-y-4 overflow-auto"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">优化 Prompt</h3>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="配置优化使用的 LLM API"
              onClick={() => {
                setOpen(false);
                onSettings();
              }}
            >
              <Settings2 />
            </Button>
          </div>
          {!desktop ? (
            <p className="text-sm text-muted-foreground">
              请在桌面版配置和使用 LLM API。
            </p>
          ) : !config ? (
            <p className="text-sm text-muted-foreground">正在读取 LLM 配置…</p>
          ) : !config.configured ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                先配置 LLM API，再优化任务描述。当前输入会保留。
              </p>
              <Button
                size="sm"
                onClick={() => {
                  setOpen(false);
                  onSettings();
                }}
              >
                配置 LLM API
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label>优化方向</Label>
                <Choice
                  label="Prompt 优化方向"
                  value={style}
                  onChange={setStyle}
                  options={[
                    { value: "clarity", label: "更清晰 · 明确目标与约束" },
                    { value: "concise", label: "更精简 · 保留重点" },
                    { value: "structured", label: "结构化 · 便于执行和验收" },
                  ]}
                />
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                使用 {config.model || "已配置模型"}
                ，仅发送输入框中的文字，不读取项目文件。可能产生 API 费用。
              </p>
              {result && (
                <>
                  <Label htmlFor="optimized-prompt">优化建议（可编辑）</Label>
                  <Textarea
                    id="optimized-prompt"
                    className="min-h-48 text-sm leading-6"
                    value={result.prompt}
                    onChange={(e) =>
                      setResult({ ...result, prompt: e.target.value })
                    }
                  />
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">查看原文</summary>
                    <p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap leading-5">
                      {result.source}
                    </p>
                  </details>
                  {prompt !== result.source && (
                    <p
                      role="status"
                      className="text-xs text-amber-700 dark:text-amber-400"
                    >
                      输入内容已改变，请重新优化，避免覆盖新内容。
                    </p>
                  )}
                </>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !prompt.trim()}
                  onClick={() => void optimize()}
                >
                  {busy ? (
                    <>
                      <LoaderCircle className="animate-spin" />
                      优化中…
                    </>
                  ) : result ? (
                    "重新优化"
                  ) : (
                    "开始优化"
                  )}
                </Button>
                {result && (
                  <Button
                    size="sm"
                    disabled={
                      busy || !result.prompt.trim() || prompt !== result.source
                    }
                    onClick={() => {
                      setUndo({ before: prompt, after: result.prompt });
                      onChange(result.prompt);
                      setResult(undefined);
                      setOpen(false);
                    }}
                  >
                    使用此版本
                  </Button>
                )}
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
