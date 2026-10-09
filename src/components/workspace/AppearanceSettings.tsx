import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { accentChoices, useAppearance } from "@/lib/appearance";
import { Choice } from "./shared";
import { cn } from "@/lib/utils";
export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  const { accent, setAccent, chatSize, setChatSize } = useAppearance();
  return (
    <section aria-label="界面设置">
      <Card className="gap-0 rounded-lg py-0 shadow-none">
        <CardContent className="divide-y px-6">
          <div className="flex flex-wrap items-center justify-between gap-4 py-5">
            <span id="theme-label" className="text-sm font-medium">
              外观
            </span>
            <div
              role="group"
              aria-labelledby="theme-label"
              className="flex gap-1 rounded-lg bg-muted p-1"
            >
              {[
                { value: "light", label: "浅色", Icon: Sun },
                { value: "dark", label: "深色", Icon: Moon },
                { value: "system", label: "跟随系统", Icon: Monitor },
              ].map(({ value, label, Icon }) => (
                <Button
                  key={value}
                  size="sm"
                  variant={theme === value ? "outline" : "ghost"}
                  aria-pressed={theme === value}
                  onClick={() => setTheme(value)}
                >
                  <Icon className="size-3.5" />
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 py-5">
            <div>
              <p id="accent-label" className="text-sm font-medium">
                主题色
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                用于主要按钮和焦点，背景保持中性。
              </p>
            </div>
            <div
              role="group"
              aria-labelledby="accent-label"
              className="flex flex-wrap gap-2"
            >
              {accentChoices.map((c) => (
                <Button
                  key={c.value}
                  size="sm"
                  variant="outline"
                  aria-pressed={accent === c.value}
                  onClick={() => setAccent(c.value)}
                  className={cn(
                    accent === c.value && "bg-accent ring-1 ring-ring",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn("size-3 rounded-full", c.swatch)}
                  />
                  {c.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 py-5">
            <span className="text-sm font-medium">对话字号</span>
            <Choice
              label="对话字号"
              value={chatSize}
              onChange={(v) => setChatSize(v as typeof chatSize)}
              options={[
                { value: "13", label: "小 · 13px" },
                { value: "14", label: "默认 · 14px" },
                { value: "16", label: "大 · 16px" },
              ]}
              className="w-36"
            />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
