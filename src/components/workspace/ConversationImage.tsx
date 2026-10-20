import { useEffect, useRef, useState } from "react";
import { ImageOff, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { call } from "@/lib/api";
import type { FileContent } from "@/lib/files";
import type { Attachment } from "@/lib/types";
import { conversationImage } from "@/lib/conversationImages";
import { ImagePreview } from "./ImagePreview";

export function ConversationImage({
  src,
  alt,
  project,
  attachments,
  remote = false,
}: {
  src: string;
  alt?: string;
  project: string;
  attachments?: Attachment[];
  remote?: boolean;
}) {
  const target = conversationImage(src, project, attachments);
  const kind = target?.kind;
  const path = target?.kind === "file" ? target.path : "";
  const id = target?.kind === "attachment" ? target.id : "";
  const url =
    target?.kind === "web" || target?.kind === "data" ? target.url : "";
  const name = alt || path.split("/").at(-1) || "图片";
  const [loaded, setLoaded] = useState("");
  const [error, setError] = useState("");
  const [allowed, setAllowed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState(false);
  const [full, setFull] = useState("");
  const [fullError, setFullError] = useState("");
  const root = useRef<HTMLSpanElement>(null);
  const unavailable = remote && (kind === "file" || kind === "attachment");
  useEffect(() => {
    if (!kind || unavailable || (kind === "web" && !allowed)) return;
    let cancelled = false;
    const load = async () => {
      try {
        const image =
          kind === "file"
            ? (
                await call<FileContent>("read_project_image", {
                  project,
                  path,
                  thumbnail: true,
                })
              ).image?.url
            : kind === "attachment"
              ? await call<string>("read_attachment", { id, thumbnail: true })
              : url;
        if (!image) throw new Error("无法显示图片");
        if (!cancelled) setLoaded(image);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting)) {
                observer?.disconnect();
                void load();
              }
            },
            { rootMargin: "200px" },
          );
    if (observer && root.current) observer.observe(root.current);
    else void load();
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [kind, path, id, project, url, unavailable, allowed, attempt]);
  useEffect(() => {
    if (!preview) return;
    let cancelled = false;
    void (async () => {
      try {
        const image =
          kind === "file"
            ? (await call<FileContent>("read_project_image", { project, path }))
                .image?.url
            : kind === "attachment"
              ? await call<string>("read_attachment", { id, thumbnail: false })
              : loaded;
        if (!image) throw new Error("无法显示图片");
        if (!cancelled) setFull(image);
      } catch (e) {
        if (!cancelled) setFullError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preview, kind, project, path, id, loaded]);
  return (
    <span
      ref={root}
      className="my-2 inline-flex max-w-full flex-col align-middle"
    >
      {!kind || unavailable ? (
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <ImageOff className="size-4" />
          {name} · {unavailable ? "图片位于执行设备" : "图片路径不可用"}
        </span>
      ) : kind === "web" && !allowed ? (
        <Button
          size="sm"
          variant="outline"
          title={url}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setAllowed(true);
          }}
        >
          加载外部图片 · {new URL(url).hostname}
        </Button>
      ) : error ? (
        <span
          className="flex items-center gap-2 text-xs text-muted-foreground"
          title={error}
        >
          <ImageOff className="size-4" />
          {name} · 无法显示
          <Button
            size="xs"
            variant="ghost"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setError("");
              setLoaded("");
              setAttempt((v) => v + 1);
            }}
          >
            重试
          </Button>
        </span>
      ) : loaded ? (
        <img
          src={loaded}
          alt={name}
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
          role="button"
          tabIndex={0}
          aria-label={`放大图片 ${name}`}
          className="max-h-80 max-w-full cursor-zoom-in rounded-md object-contain focus-visible:outline-2 focus-visible:outline-ring"
          onError={() => setError("无法显示图片")}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setPreview(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              setPreview(true);
            }
          }}
        />
      ) : (
        <span
          role="status"
          className="inline-flex min-h-20 items-center gap-2 text-xs text-muted-foreground"
        >
          <LoaderCircle className="size-4 animate-spin" />
          加载图片
        </span>
      )}
      <Dialog
        open={preview}
        onOpenChange={(open) => {
          setPreview(open);
          if (!open) {
            setFull("");
            setFullError("");
          }
        }}
      >
        <DialogContent
          className="flex h-[80dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
          aria-describedby={undefined}
        >
          <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12">
            <DialogTitle className="truncate text-sm">{name}</DialogTitle>
          </DialogHeader>
          {fullError ? (
            <p role="alert" className="p-4 text-sm text-muted-foreground">
              {fullError}
            </p>
          ) : full ? (
            <div className="min-h-0 flex-1">
              <ImagePreview key={full} src={full} name={name} />
            </div>
          ) : (
            <span
              role="status"
              className="flex flex-1 items-center justify-center"
            >
              <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
            </span>
          )}
        </DialogContent>
      </Dialog>
    </span>
  );
}
