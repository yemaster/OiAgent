import { useRef, useState } from "react";
import { ChevronDown, FolderClock, FolderCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

export function TemporaryProjectMenu({
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
  const trigger = useRef<HTMLButtonElement>(null);
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
      {project.status === "cleaned" ? (
        <Badge
          variant="secondary"
          className="shrink-0 text-xs font-normal text-muted-foreground"
        >
          临时文件已清理
        </Badge>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={trigger}
              variant="ghost"
              size="xs"
              disabled={busy}
              className="shrink-0 font-normal text-muted-foreground"
              aria-label="临时项目操作"
            >
              <FolderClock />
              {project.status === "cleaning" ? "清理未完成" : "临时项目"}
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-40"
            onCloseAutoFocus={(event) => {
              if (confirm) event.preventDefault();
            }}
          >
            {project.status === "active" && (
              <DropdownMenuItem disabled={busy} onSelect={() => void keep()}>
                <FolderCheck />
                保留项目
              </DropdownMenuItem>
            )}
            <DropdownMenuItem disabled={busy} onSelect={() => setConfirm(true)}>
              <Trash2 />
              清理临时文件
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Dialog
        open={confirm}
        onOpenChange={(open) => {
          if (!busy) setConfirm(open);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
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
