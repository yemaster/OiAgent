import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { call } from "@/lib/api";
import type { Detail, Task } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface Prepared {
  rewind: { files: string[]; token: string } | null;
  rewindUnavailable: string | null;
}
export function EditMessage({
  detail,
  index,
  hasUnsavedFiles,
  onClose,
  onSaved,
}: {
  detail: Detail;
  index: number;
  hasUnsavedFiles: boolean;
  onClose: () => void;
  onSaved: (task: Task, replace: boolean) => void;
}) {
  const [text, setText] = useState(detail.messages[index].text);
  const [mode, setMode] = useState("branch");
  const [rewind, setRewind] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const lock = useRef(false);
  // Keep the same request ID after a lost response; retry must never rewind twice.
  const request = useRef({ id: crypto.randomUUID(), signature: "" });
  useEffect(() => {
    let cancelled = false;
    void call<Prepared>("prepare_message_edit", {
      id: detail.task.id,
      revision: detail.revision,
      index,
    })
      .then((result) => {
        if (!cancelled) setPrepared(result);
      })
      .catch((error) => {
        if (!cancelled) setError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [detail, index]);
  async function toggleRewind(enabled: boolean) {
    if (!enabled) {
      setRewind(false);
      return;
    }
    if (prepared?.rewind) {
      setRewind(true);
      return;
    }
    setPreviewBusy(true);
    setError("");
    try {
      const result = await call<Prepared>("prepare_message_edit", {
        id: detail.task.id,
        revision: detail.revision,
        index,
        inspectFiles: true,
      });
      setPrepared(result);
      setRewind(!!result.rewind?.files.length);
    } catch (error) {
      setError(String(error));
    } finally {
      setPreviewBusy(false);
    }
  }
  async function submit() {
    if (
      lock.current ||
      previewBusy ||
      !text.trim() ||
      !prepared ||
      (rewind && (hasUnsavedFiles || !prepared.rewind))
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    const signature = JSON.stringify([
      text,
      mode,
      rewind,
      prepared.rewind?.token,
    ]);
    if (request.current.signature && request.current.signature !== signature)
      request.current.id = crypto.randomUUID();
    request.current.signature = signature;
    try {
      const result = await call<{ task: Task; launchError: string | null }>(
        "edit_message",
        {
          input: {
            id: detail.task.id,
            revision: detail.revision,
            index,
            text,
            mode,
            requestId: request.current.id,
            rewindToken: rewind ? prepared.rewind!.token : null,
          },
        },
      );
      if (result.launchError) toast.error(result.launchError);
      onSaved(result.task, mode === "replace");
    } catch (error) {
      setError(String(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const unavailable = hasUnsavedFiles
    ? "请先保存或关闭未保存的文件"
    : prepared?.rewindUnavailable;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-xl"
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>编辑消息</DialogTitle>
          <DialogDescription className="sr-only">
            选择新建分支或替换，并按需恢复文件。
          </DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label="消息内容"
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={busy}
          className="max-h-[40vh] min-h-40 resize-y"
        />
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="message-edit-mode">后续对话</Label>
          <Select value={mode} onValueChange={setMode} disabled={busy}>
            <SelectTrigger id="message-edit-mode" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="branch">新建分支</SelectItem>
              <SelectItem value="replace">替换当前对话</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {mode === "replace" && (
          <p className="text-xs text-muted-foreground">原对话将移入已归档。</p>
        )}
        <div className="space-y-2 border-t pt-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="message-rewind">撤销此处之后的文件修改</Label>
            <Switch
              id="message-rewind"
              checked={rewind}
              onCheckedChange={(enabled) => void toggleRewind(enabled)}
              disabled={
                busy ||
                previewBusy ||
                !prepared ||
                !!unavailable ||
                (prepared.rewind !== null && !prepared.rewind.files.length)
              }
            />
          </div>
          {(!prepared || previewBusy) && !error ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderCircle className="size-3 animate-spin" />
              检查文件恢复点…
            </p>
          ) : unavailable ? (
            <p className="text-xs text-muted-foreground">{unavailable}</p>
          ) : prepared?.rewind && !prepared.rewind.files.length ? (
            <p className="text-xs text-muted-foreground">没有可恢复的文件</p>
          ) : null}
          {rewind && prepared?.rewind && (
            <>
              <p className="text-xs text-muted-foreground">
                仅恢复 Agent
                检查点内的文件。当前内容会先备份；命令及外部服务的改动不会撤销。
              </p>
              <ul
                aria-label="待恢复文件"
                className="max-h-32 overflow-auto rounded-md bg-muted/40 p-2 text-xs"
              >
                {prepared.rewind.files.map((path) => (
                  <li key={path} className="truncate py-1" title={path}>
                    {path.startsWith(detail.task.project + "/")
                      ? path.slice(detail.task.project.length + 1)
                      : path}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={
              busy ||
              previewBusy ||
              !prepared ||
              !text.trim() ||
              (rewind && !!unavailable)
            }
            onClick={() => void submit()}
          >
            {busy && <LoaderCircle className="size-4 animate-spin" />}保存并发送
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
