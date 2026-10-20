import { useContext, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ImagePreview } from "./ImagePreview";
import { ImageEditorContext } from "@/lib/imageEditor";
import { call } from "@/lib/api";
import type { FileContent } from "@/lib/files";

export function ImageDialog({
  open,
  onOpenChange,
  name,
  src,
  error,
  onOpenEditor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  src?: string;
  error?: string;
  onOpenEditor?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(65dvh,560px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        aria-describedby={undefined}
      >
        <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12">
          <DialogTitle className="truncate text-sm">{name}</DialogTitle>
        </DialogHeader>
        {error ? (
          <p role="alert" className="p-4 text-sm text-muted-foreground">
            {error}
          </p>
        ) : src ? (
          <div className="min-h-0 flex-1">
            <ImagePreview key={src} src={src} name={name} />
          </div>
        ) : (
          <span
            role="status"
            className="flex flex-1 items-center justify-center"
          >
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          </span>
        )}
        {onOpenEditor && (
          <div className="flex shrink-0 justify-end border-t px-3 py-2">
            <Button size="xs" variant="link" onClick={onOpenEditor}>
              在编辑器中打开
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ProjectImageDialog({
  project,
  path,
  onClose,
}: {
  project: string;
  path: string;
  onClose: () => void;
}) {
  const openEditor = useContext(ImageEditorContext);
  const [result, setResult] = useState<{ url?: string; error?: string }>({});
  useEffect(() => {
    let disposed = false;
    void call<FileContent>("read_project_image", { project, path })
      .then((value) => {
        if (!value.image) throw new Error("无法显示图片");
        if (!disposed) setResult({ url: value.image.url });
      })
      .catch((error) => {
        if (!disposed) setResult({ error: String(error) });
      });
    return () => {
      disposed = true;
    };
  }, [project, path]);
  return (
    <ImageDialog
      open
      name={path.split(/[\\/]/).at(-1)!}
      src={result.url}
      error={result.error}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onOpenEditor={
        openEditor
          ? () => {
              onClose();
              openEditor(project, path);
            }
          : undefined
      }
    />
  );
}
