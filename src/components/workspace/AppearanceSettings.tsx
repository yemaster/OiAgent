import {
  surfaces,
  defaultSurfaces,
  editorThemes,
  validColor,
  type Surface,
} from "@/lib/surfaceColors";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { accentChoices, useAppearance } from "@/lib/appearance";
import { Choice } from "./shared";
import { cn } from "@/lib/utils";
export function AppearanceSettings() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mode = resolvedTheme === "dark" ? "dark" : "light";
  const {
    accent,
    setAccent,
    chatSize,
    setChatSize,
    surfaces: colors,
    setSurface,
    resetSurfaces,
    editorTheme,
    setEditorTheme,
  } = useAppearance();
  function changeColor(surface: Surface, color: string) {
    if (!validColor(color)) {
      toast.error("请填写六位 HEX 色值，例如 #f7f7f5");
      return;
    }
    setSurface(mode, surface, color.toLowerCase());
  }
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
                用于主要按钮和焦点。
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
          <div className="space-y-4 py-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium">背景颜色</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  当前编辑{mode === "dark" ? "深色" : "浅色"}
                  外观，明暗模式分别保存。
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => resetSurfaces(mode)}
              >
                恢复默认背景
              </Button>
            </div>
            {surfaces.map(({ id, label }) => {
              const color = colors[mode][id] || defaultSurfaces[mode][id];
              return (
                <div
                  key={`${mode}-${id}`}
                  className="flex flex-wrap items-center justify-between gap-3"
                >
                  <Label htmlFor={`surface-${id}`}>{label}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`surface-${id}`}
                      aria-label={label}
                      type="color"
                      className="h-8 w-10 cursor-pointer p-1"
                      value={color}
                      onChange={(e) => changeColor(id, e.target.value)}
                    />
                    <Input
                      key={color}
                      aria-label={`${label} HEX`}
                      className="w-28 font-mono text-xs"
                      defaultValue={color}
                      maxLength={7}
                      onBlur={(e) => {
                        if (validColor(e.target.value))
                          changeColor(id, e.target.value);
                        else {
                          toast.error("请输入六位 HEX 色值");
                          e.target.value = color;
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!colors[mode][id]}
                      onClick={() => setSurface(mode, id, undefined)}
                    >
                      重置
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 py-5">
            <span className="text-sm font-medium">代码编辑器主题</span>
            <Choice
              label="代码编辑器主题"
              value={editorTheme}
              onChange={(value) => setEditorTheme(value as typeof editorTheme)}
              options={[...editorThemes]}
              className="w-52"
            />
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
