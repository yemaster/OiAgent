import { useEffect, useState } from "react";
import { call, desktop } from "@/lib/api";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
type Mode = "off" | "first" | "every";
export function TaskTitleSettings() {
  const [mode, setMode] = useState<Mode>("first");
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const read = desktop
      ? call<Mode>("task_title_mode")
      : Promise.resolve(
          (localStorage.getItem("oiagent-title-mode") || "first") as Mode,
        );
    void read
      .then((mode) => {
        if (!cancelled) setMode(mode);
      })
      .catch((error) => toast.error(String(error)))
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  async function change(value: string) {
    setBusy(true);
    try {
      if (desktop) await call("set_task_title_mode", { mode: value });
      else localStorage.setItem("oiagent-title-mode", value);
      setMode(value as Mode);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center justify-between gap-6 py-5">
      <div>
        <Label htmlFor="task-title-mode">任务标题</Label>
        <p className="mt-2 text-xs text-muted-foreground">
          使用已配置的 LLM API，保留手动命名。
        </p>
      </div>
      <Select
        value={mode}
        disabled={busy}
        onValueChange={(value) => void change(value)}
      >
        <SelectTrigger id="task-title-mode" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="off">不总结标题</SelectItem>
          <SelectItem value="first">仅首次总结</SelectItem>
          <SelectItem value="every">每次总结</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
