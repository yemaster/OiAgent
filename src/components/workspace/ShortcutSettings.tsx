import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  captureShortcut,
  resetShortcuts,
  setShortcut,
  shortcutDefinitions,
  shortcutGroups,
  shortcutLabel,
  shortcutsConflict,
  useShortcuts,
  shortcutPlatform,
  type ShortcutPlatform,
  type ShortcutId,
} from "@/lib/shortcuts";

export function ShortcutSettings() {
  const [platform, setPlatform] = useState<ShortcutPlatform>(shortcutPlatform);
  const shortcuts = useShortcuts(platform);
  const [recording, setRecording] = useState<ShortcutId | null>(null);
  useEffect(() => {
    window.dispatchEvent(new Event("oiagent-shortcut-recording"));
    return () => {
      window.dispatchEvent(new Event("oiagent-shortcut-recording"));
    };
  }, [recording]);
  return (
    <section aria-label="快捷键" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Tabs
          value={platform}
          onValueChange={(value) => {
            setRecording(null);
            setPlatform(value as ShortcutPlatform);
          }}
        >
          <TabsList aria-label="操作系统">
            <TabsTrigger value="windows">Windows</TabsTrigger>
            <TabsTrigger value="linux">Linux</TabsTrigger>
            <TabsTrigger value="macos">macOS</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            try {
              resetShortcuts(platform);
              setRecording(null);
            } catch {
              toast.error("快捷键保存失败");
            }
          }}
        >
          恢复默认
        </Button>
      </div>
      <div className="space-y-6">
        {shortcutGroups.map((group) => (
          <section
            key={group.id}
            aria-labelledby={`shortcut-group-${group.id}`}
            className="space-y-2"
          >
            <h2
              id={`shortcut-group-${group.id}`}
              className="text-sm font-medium"
            >
              {group.label}
            </h2>
            <dl className="divide-y divide-border/60 rounded-lg border border-border/60 px-4">
              {shortcutDefinitions
                .filter((item) => item.group === group.id)
                .map(({ id, label }) => {
                  const conflicts = shortcutDefinitions.filter(
                    (other) =>
                      other.id !== id &&
                      shortcutsConflict(
                        shortcuts[id],
                        shortcuts[other.id],
                        platform === "macos",
                      ),
                  );
                  return (
                    <div
                      key={id}
                      className="flex min-h-12 items-center justify-between gap-4 py-2 text-sm"
                    >
                      <dt>{label}</dt>
                      <dd className="flex shrink-0 items-center gap-3">
                        {conflicts.length > 0 && (
                          <span
                            className="text-xs text-amber-600 dark:text-amber-400"
                            title={conflicts.map((s) => s.label).join("、")}
                          >
                            冲突
                          </span>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-w-32 font-normal"
                          aria-label={`${label}快捷键`}
                          aria-pressed={recording === id}
                          data-shortcut-recorder={
                            recording === id ? "true" : undefined
                          }
                          onClick={() => setRecording(id)}
                          onBlur={() => setRecording(null)}
                          onKeyDown={(e) => {
                            if (recording !== id) return;
                            e.preventDefault();
                            e.stopPropagation();
                            if (e.key === "Escape") {
                              setRecording(null);
                              return;
                            }
                            const value = captureShortcut(e.nativeEvent);
                            if (!value) return;
                            try {
                              setShortcut(id, value, platform);
                              setRecording(null);
                            } catch {
                              toast.error("快捷键保存失败");
                            }
                          }}
                        >
                          {recording === id
                            ? "请按快捷键…"
                            : shortcutLabel(shortcuts[id], platform)}
                        </Button>
                      </dd>
                    </div>
                  );
                })}
            </dl>
          </section>
        ))}
      </div>
    </section>
  );
}
