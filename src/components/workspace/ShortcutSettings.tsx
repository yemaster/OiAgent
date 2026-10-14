import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Choice } from "./shared";
import {
  sendShortcuts,
  setSendShortcut,
  useSendShortcut,
  type SendShortcut,
} from "@/lib/shortcuts";

export function ShortcutSettings() {
  const value = useSendShortcut();
  function save(value: SendShortcut) {
    try {
      setSendShortcut(value);
    } catch {
      toast.error("快捷键保存失败，请重试");
    }
  }
  return (
    <div className="space-y-6">
      <Card className="gap-0 rounded-lg py-0 shadow-none">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Label>发送消息 / 启动任务</Label>
            <Choice
              label="发送快捷键"
              value={value}
              onChange={(v) => save(v as SendShortcut)}
              options={[...sendShortcuts]}
            />
          </div>
          <p className="text-xs leading-6 text-muted-foreground">
            适用于新建任务和对话。Shift + Enter 换行。
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={value === "mod-enter"}
            onClick={() => save("mod-enter")}
          >
            恢复默认
          </Button>
        </CardContent>
      </Card>
      <section aria-label="常用快捷键" className="space-y-3">
        <h2 className="text-sm font-medium">常用快捷键</h2>
        <dl className="divide-y rounded-lg border px-5">
          {[
            ["新建任务", "⌘ / Ctrl + N"],
            ["搜索任务", "⌘ / Ctrl + K"],
            ["保存文件", "⌘ / Ctrl + S"],
            ["关闭标签", "⌘ / Ctrl + W"],
            ["显示 / 隐藏侧栏", "⌘ / Ctrl + B"],
            ["返回上一页", "Alt + ←"],
          ].map(([name, keys]) => (
            <div key={name} className="flex justify-between gap-4 py-3 text-sm">
              <dt>{name}</dt>
              <dd className="text-muted-foreground">{keys}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
