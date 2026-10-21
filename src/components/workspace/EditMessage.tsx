import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, LoaderCircle, RotateCcw } from "lucide-react";
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
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import { AttachmentList } from "./Attachments";
import { pasteMessage } from "@/lib/messageClipboard";
import { toast } from "sonner";

interface Prepared {
  rewind: { files: string[]; token: string } | null;
  rewindUnavailable: string | null;
}
export function EditMessage({
  detail,
  index,
  target,
  disabled = false,
  hasUnsavedFiles,
  onClose,
  onSaved,
}: {
  // Keep the controller mounted when windowed history temporarily removes its anchor.
  target?: HTMLElement | null;
  disabled?: boolean;
  detail: Detail;
  index: number;
  hasUnsavedFiles: boolean;
  onClose: () => void;
  onSaved: (task: Task, replace: boolean) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const focused = useRef(false);
  const id = useId();
  const reduced = useReducedMotion();
  const [options, setOptions] = useState(false);
  useEffect(() => {
    if (target === null || focused.current || !input.current) return;
    input.current.focus({ preventScroll: true });
    input.current.setSelectionRange(
      input.current.value.length,
      input.current.value.length,
    );
    focused.current = true;
  }, [target]);
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
      disabled ||
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
  function cancel() {
    const message = target?.closest("section");
    onClose();
    requestAnimationFrame(() =>
      message
        ?.querySelector<HTMLButtonElement>('button[aria-label="编辑消息"]')
        ?.focus({ preventScroll: true }),
    );
  }
  const content = (
    <motion.div
      role="group"
      aria-label="编辑消息"
      aria-busy={busy}
      initial={reduced ? false : { opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.14 }}
      className="space-y-3"
    >
      {!!detail.messages[index].attachments?.length && (
        <AttachmentList items={detail.messages[index].attachments!} />
      )}
      <Textarea
        ref={input}
        aria-label="消息内容"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onPaste={(event) => pasteMessage(event, setText)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            if (!busy && !previewBusy) cancel();
          }
        }}
        disabled={busy}
        className="max-h-[40vh] min-h-28 resize-y border-0 bg-transparent px-0 py-1 text-sm leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select value={mode} onValueChange={setMode} disabled={busy}>
          <SelectTrigger
            aria-label="后续对话"
            className="h-7 w-auto gap-2 border-0 bg-transparent px-2 text-xs shadow-none dark:bg-transparent"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="branch">新建分支</SelectItem>
            <SelectItem value="replace">替换当前对话</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="xs"
          variant="ghost"
          aria-expanded={options}
          aria-controls={`${id}-files`}
          onClick={() => setOptions((open) => !open)}
        >
          <RotateCcw />
          文件恢复{rewind ? ` · ${prepared?.rewind?.files.length || 0}` : ""}
          <ChevronDown
            className={
              options
                ? "rotate-180 transition-transform"
                : "transition-transform"
            }
          />
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || previewBusy}
            onClick={cancel}
          >
            取消
          </Button>
          <Button
            size="sm"
            disabled={
              disabled ||
              busy ||
              previewBusy ||
              !prepared ||
              !text.trim() ||
              (rewind && !!unavailable)
            }
            onClick={() => void submit()}
          >
            {busy && <LoaderCircle className="size-3.5 animate-spin" />}
            保存并发送
          </Button>
        </div>
      </div>
      {mode === "replace" && (
        <p className="text-xs text-muted-foreground">原对话将移入已归档。</p>
      )}
      {options && (
        <motion.div
          id={`${id}-files`}
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-2 border-t border-border/60 pt-3"
        >
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`${id}-rewind`} className="text-xs">
              撤销此处之后的文件修改
            </Label>
            <Switch
              id={`${id}-rewind`}
              checked={rewind}
              onCheckedChange={(enabled) => void toggleRewind(enabled)}
              disabled={
                disabled ||
                busy ||
                previewBusy ||
                !prepared ||
                !!unavailable ||
                (prepared.rewind !== null && !prepared.rewind.files.length)
              }
            />
          </div>
          {(!prepared || previewBusy) && !error ? (
            <p
              role="status"
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
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
                先备份，再恢复检查点内的文件；命令及外部服务的改动不受影响。
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
        </motion.div>
      )}
      {disabled && (
        <p role="status" className="text-xs text-muted-foreground">
          任务停止后可保存修改
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </motion.div>
  );
  return target === undefined
    ? content
    : target
      ? createPortal(content, target)
      : null;
}
