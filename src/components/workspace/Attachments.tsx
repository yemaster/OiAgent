import { useContext, useEffect, useRef, useState } from "react";
import { File, Image, LoaderCircle, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageDialog } from "./ImageDialog";
import { ImageEditorContext } from "@/lib/imageEditor";
import { ContextActions } from "./ContextActions";
import { copyImage } from "@/lib/imageClipboard";
import { toast } from "sonner";
import { call } from "@/lib/api";
import type { Attachment } from "@/lib/types";
import type { AttachmentDraft } from "@/hooks/useAttachments";

function Thumbnail({ item }: { item: Attachment }) {
  const [url, setUrl] = useState("");
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!item.mime.startsWith("image/")) return;
    let disposed = false;
    const load = () => {
      void call<string>("read_attachment", { id: item.id, thumbnail: true })
        .then((url) => {
          if (!disposed) setUrl(url);
        })
        .catch(() => {});
    };
    const observer =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
              observer?.disconnect();
              load();
            }
          })
        : null;
    if (observer && root.current) observer.observe(root.current);
    else load();
    return () => {
      disposed = true;
      observer?.disconnect();
    };
  }, [item.id, item.mime]);
  const thumbnail = (
    <span
      ref={root}
      className="flex size-10 shrink-0 items-center justify-center"
    >
      {url ? (
        <img src={url} alt="" className="size-10 rounded object-cover" />
      ) : item.mime.startsWith("image/") ? (
        <Image className="size-5 text-muted-foreground" />
      ) : (
        <File className="size-5 text-muted-foreground" />
      )}
    </span>
  );
  return item.mime.startsWith("image/") ? (
    <ContextActions
      actions={[
        {
          label: "复制图片",
          action: () =>
            void copyImage(() =>
              call<string>("read_attachment", {
                id: item.id,
                thumbnail: false,
              }),
            ),
        },
      ]}
    >
      {thumbnail}
    </ContextActions>
  ) : (
    thumbnail
  );
}
export function AttachmentList({
  items,
  onRemove,
  disabled = false,
  remote = false,
}: {
  items: Attachment[];
  remote?: boolean;
  onRemove?: (id: string) => void;
  disabled?: boolean;
}) {
  const openEditor = useContext(ImageEditorContext);
  const [preview, setPreview] = useState<{
    name: string;
    url: string;
    path: string;
  } | null>(null);
  const opening = useRef(false);
  async function open(item: Attachment) {
    if (opening.current) return;
    opening.current = true;
    try {
      if (item.mime.startsWith("image/")) {
        const url = await call<string>("read_attachment", {
          id: item.id,
          thumbnail: false,
        });
        setPreview({ name: item.name, url, path: item.path });
      } else await call("reveal_attachment", { id: item.id });
    } catch (error) {
      toast.error(String(error));
    } finally {
      opening.current = false;
    }
  }
  if (!items.length) return null;
  return (
    <>
      <div className="flex flex-wrap gap-2 px-2 py-2" aria-label="附件">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex max-w-64 items-center gap-2 rounded-lg border bg-muted/30 px-2 py-1.5"
            title={item.name}
          >
            <button
              type="button"
              className="flex min-w-0 items-center gap-2 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`${item.mime.startsWith("image/") ? "预览" : "在文件夹中显示"} ${item.name}`}
              disabled={remote}
              title={remote ? "附件位于执行设备" : undefined}
              onClick={() => void open(item)}
            >
              {remote ? (
                <File className="size-5 shrink-0 text-muted-foreground" />
              ) : (
                <Thumbnail item={item} />
              )}
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium">
                  {item.name}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {item.size < 1024 * 1024
                    ? `${Math.max(1, Math.round(item.size / 1024))} KB`
                    : `${(item.size / 1024 / 1024).toFixed(1)} MB`}
                </span>
              </span>
            </button>
            {onRemove && (
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                disabled={disabled}
                aria-label={`移除 ${item.name}`}
                onClick={() => onRemove(item.id)}
              >
                <X />
              </Button>
            )}
          </div>
        ))}
      </div>
      <ImageDialog
        open={!!preview}
        name={preview?.name || "图片"}
        src={preview?.url}
        onOpenEditor={
          openEditor && preview
            ? () => {
                const path = preview.path.replace(/\\/g, "/");
                setPreview(null);
                openEditor(
                  path.slice(0, path.lastIndexOf("/")),
                  path.slice(path.lastIndexOf("/") + 1),
                );
              }
            : undefined
        }
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      />
    </>
  );
}
export function AttachmentButton({
  draft,
  disabled = false,
}: {
  draft: AttachmentDraft;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      className="text-muted-foreground"
      aria-label="添加附件"
      title={
        draft.disabled ? "请在本机 Agent 对话中添加附件" : "添加图片或文件"
      }
      disabled={disabled || draft.disabled || draft.loading}
      onClick={() => void draft.pick()}
    >
      {draft.loading ? (
        <LoaderCircle className="animate-spin" />
      ) : (
        <Paperclip />
      )}
    </Button>
  );
}
