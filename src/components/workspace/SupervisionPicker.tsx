import { useState } from "react";
import { Check, ChevronDown, ShieldCheck, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Choice } from "./shared";
import { supervisionModes, type SupervisionConfig } from "@/lib/supervision";

export function SupervisionPicker({
  value,
  onChange,
  disabled,
  phase,
  onSettings,
}: {
  value: SupervisionConfig;
  onChange: (value: SupervisionConfig) => void;
  disabled?: boolean;
  phase?: string;
  onSettings?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const selected =
    supervisionModes.find((mode) => mode.value === value.mode) ||
    supervisionModes[0];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={value.mode === "off" ? "ghost" : "secondary"}
          size="sm"
          disabled={disabled}
          className="h-8 gap-1.5 text-xs font-normal"
          aria-label={`监管：${selected.label}`}
        >
          {phase === "checking" ? (
            <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
          ) : (
            <ShieldCheck className="size-3.5" />
          )}
          监管 ·{" "}
          {phase === "checking"
            ? "检查中"
            : phase === "needs_user"
              ? "待处理"
              : selected.label}
          <ChevronDown className="size-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div role="radiogroup" aria-label="监管模式" className="space-y-0.5">
          {supervisionModes.map((mode) => (
            <Button
              key={mode.value}
              role="radio"
              aria-checked={mode.value === value.mode}
              variant="ghost"
              className="h-auto w-full justify-start px-2 py-2 text-left"
              onClick={() => onChange({ ...value, mode: mode.value })}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{mode.label}</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {mode.description}
                </span>
              </span>
              {value.mode === mode.value && <Check className="size-4" />}
            </Button>
          ))}
        </div>
        {value.mode !== "off" && (
          <div className="mt-2 flex items-center justify-between border-t px-2 pt-3 pb-1">
            <Label className="text-xs">自动续办上限</Label>
            <Choice
              label="自动续办上限"
              value={String(value.maxRetries)}
              onChange={(next) =>
                onChange({ ...value, maxRetries: Number(next) })
              }
              options={[1, 2, 3, 4, 5].map((count) => ({
                value: String(count),
                label: `${count} 次`,
              }))}
            />
          </div>
        )}
        {onSettings && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full justify-start text-xs text-muted-foreground"
            onClick={() => {
              setOpen(false);
              onSettings();
            }}
          >
            配置 AI 来源…
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
