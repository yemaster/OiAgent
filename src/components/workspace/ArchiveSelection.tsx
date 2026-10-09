import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArchiveRestore, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { call } from "@/lib/api";
import { splitRemoteId, remoteId } from "@/lib/lan";
import type { Task } from "@/lib/types";
import { toast } from "sonner";
const Selection = createContext<{
  enabled: boolean;
  busy: boolean;
  ids: Set<string>;
  toggle: (id: string, checked: boolean) => void;
  toolbar: ReactNode;
}>({ enabled: false, busy: false, ids: new Set(), toggle() {}, toolbar: null });
export function ArchiveCheckbox({ task }: { task: Task }) {
  const value = useContext(Selection);
  return value.enabled ? (
    <Checkbox
      className="ml-3 shrink-0"
      aria-label={`选择会话：${task.title}`}
      checked={value.ids.has(task.id)}
      disabled={value.busy}
      onCheckedChange={(checked) => value.toggle(task.id, checked === true)}
    />
  ) : null;
}
export function ArchiveToolbar() {
  return useContext(Selection).toolbar;
}
export function ArchiveSelection({
  enabled,
  scope,
  tasks,
  children,
  onDeleted,
  onRefresh,
}: {
  enabled: boolean;
  scope: string;
  tasks: Task[];
  children: ReactNode;
  onDeleted?: (ids: string[]) => Promise<void>;
  onRefresh?: () => Promise<void>;
}) {
  const [selection, setSelection] = useState<{
    scope: string;
    ids: Set<string>;
  }>({ scope, ids: new Set() });
  if (selection.scope !== scope) {
    setSelection({ scope, ids: new Set() });
  }
  const [deleting, setDeleting] = useState<Task[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const ids = new Set(
    enabled && selection.scope === scope
      ? tasks.filter((t) => selection.ids.has(t.id)).map((t) => t.id)
      : [],
  );
  const selected = tasks.filter((t) => ids.has(t.id));
  function toggle(id: string, checked: boolean) {
    const next = new Set(ids);
    if (checked) next.add(id);
    else next.delete(id);
    setSelection({ scope, ids: next });
  }
  async function run(action: "restore" | "delete", targets: Task[]) {
    if (lock.current || !targets.length) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const succeeded: string[] = [],
      errors: string[] = [];
    try {
      if (action === "restore") {
        for (const task of targets) {
          try {
            await call("archive_task", { id: task.id, archived: false });
            succeeded.push(task.id);
          } catch (e) {
            errors.push(`${task.title}：${e}`);
          }
        }
      } else {
        const groups = new Map<string, Task[]>();
        for (const task of targets) {
          const peer = splitRemoteId(task.id)?.peerId || "local";
          groups.set(peer, [...(groups.get(peer) || []), task]);
        }
        for (const [deviceId, group] of groups) {
          try {
            const result = await call<{
              ids: string[];
              cleanupWarnings: string[];
            }>("delete_archived_tasks", {
              ids: group.map((t) => splitRemoteId(t.id)?.id || t.id),
              ...(deviceId === "local" ? {} : { deviceId }),
            });
            succeeded.push(
              ...result.ids.map((id) =>
                deviceId === "local" ? id : remoteId(deviceId, id),
              ),
            );
            if (result.cleanupWarnings.length)
              errors.push(
                "记录已删除，部分本地日志未能清理：" +
                  result.cleanupWarnings.join("；"),
              );
          } catch (e) {
            errors.push(`${group[0].deviceName || "本机"}：${e}`);
          }
        }
      }
      setSelection({
        scope,
        ids: new Set([...ids].filter((id) => !succeeded.includes(id))),
      });
      if (succeeded.length) {
        if (action === "delete") await onDeleted?.(succeeded);
        else await onRefresh?.();
        toast.success(
          `已${action === "delete" ? "删除" : "恢复"} ${targets.filter((t) => succeeded.includes(t.id)).length} 条会话`,
        );
      }
      setDeleting(null);
      if (errors.length) setError(errors.join("\n"));
    } catch (e) {
      setError(`操作后刷新失败：${e}`);
      setDeleting(null);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const toolbar = enabled ? (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center gap-3 rounded-md border bg-card px-3 py-2">
        <Checkbox
          aria-label={`全选筛选结果（${tasks.length} 条）`}
          disabled={busy || !tasks.length}
          checked={
            ids.size === tasks.length && !!tasks.length
              ? true
              : ids.size
                ? "indeterminate"
                : false
          }
          onCheckedChange={(checked) =>
            setSelection({
              scope,
              ids: new Set(checked === true ? tasks.map((t) => t.id) : []),
            })
          }
        />
        <span className="text-xs text-muted-foreground">
          {ids.size ? `已选 ${ids.size} 条` : `共 ${tasks.length} 条`}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !ids.size}
          onClick={() => void run("restore", selected)}
        >
          <ArchiveRestore />
          恢复所选
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          disabled={busy || !ids.size}
          onClick={() => setDeleting(selected)}
        >
          <Trash2 />
          删除所选
        </Button>
        {ids.size > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            disabled={busy}
            onClick={() => setSelection({ scope, ids: new Set() })}
          >
            取消选择
          </Button>
        )}
      </div>
      {error && (
        <p
          role="alert"
          className="whitespace-pre-wrap text-sm text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  ) : null;
  return (
    <Selection.Provider value={{ enabled, busy, ids, toggle, toolbar }}>
      {children}
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除 {deleting?.length || 0} 条归档会话？</DialogTitle>
            <DialogDescription>
              删除所选会话及子任务在 OiAgent
              中的记录和执行日志。项目文件保留，导入的原始 Agent
              历史文件保留，删除的记录不会再次导入。
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
            {deleting?.map((t) => (
              <li key={t.id} className="truncate">
                {t.title}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void run("delete", deleting || [])}
            >
              {busy ? "正在删除…" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Selection.Provider>
  );
}
