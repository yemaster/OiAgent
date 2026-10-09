import { useState } from "react";
import { FolderClock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { call } from "@/lib/api";
import type { TemporaryProject } from "@/lib/types";

export function TemporaryProjectBar({
  project,
  onChanged,
  onCleanup,
}: {
  project: TemporaryProject;
  onChanged: () => Promise<void>;
  onCleanup: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  async function keep() {
    setBusy(true);
    try {
      await call("keep_temporary_project", { id: project.id });
      await onChanged();
      toast.success("项目已保留，不再自动清理");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/30 px-5 py-2 text-xs">
        <FolderClock className="size-4 text-muted-foreground" />
        <span className="font-medium">
          {project.status === "cleaned" ? "临时文件已清理" : "临时项目"}
        </span>
        <span className="min-w-0 flex-1 text-muted-foreground">
          {project.status === "cleaned"
            ? "对话记录仍可查看。继续工作请新建任务。"
            : project.status === "cleaning"
              ? "清理尚未完成，可重试。"
              : project.cleanupAfter
                ? `归档保留至 ${new Date(project.cleanupAfter).toLocaleDateString()}，之后启动应用时清理。`
                : "所有任务归档 7 天后清理，也可保留项目。"}
        </span>
        {project.status === "active" && (
          <Button
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={() => void keep()}
          >
            保留项目
          </Button>
        )}
        {project.status !== "cleaned" && (
          <Button
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            清理临时文件
          </Button>
        )}
      </div>
      <Dialog
        open={confirm}
        onOpenChange={(open) => {
          if (!busy) setConfirm(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>清理临时项目文件？</DialogTitle>
            <DialogDescription>
              此目录中的文件将被永久删除，相关任务会归档，对话记录保留。需要文件时，请先保留项目或将文件复制到其他目录。
            </DialogDescription>
          </DialogHeader>
          <code className="break-all text-xs text-muted-foreground">
            {project.path}
          </code>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onCleanup();
                  setConfirm(false);
                  toast.success("临时文件已清理");
                } catch (e) {
                  toast.error(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "正在清理…" : "删除文件并归档"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
