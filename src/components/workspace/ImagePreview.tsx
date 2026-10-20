import { useState } from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shared viewer for editor tabs and message previews. SVG stays in image context. */
export function ImagePreview({ src, name }: { src: string; name: string }) {
  const [scale, setScale] = useState<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-10 shrink-0 items-center justify-end gap-1 border-b px-3">
        {size.width > 0 && (
          <span className="mr-auto text-xs tabular-nums text-muted-foreground">
            {size.width} × {size.height}
          </span>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="缩小图片"
          disabled={failed || !size.width || (scale !== null && scale <= 0.1)}
          onClick={() => setScale(Math.max(0.1, (scale ?? 1) / 1.5))}
        >
          <ZoomOut />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={failed}
          onClick={() => setScale(scale === 1 ? null : 1)}
        >
          {scale === null ? "适应窗口" : `${Math.round(scale * 100)}%`}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="放大图片"
          disabled={failed || !size.width || (scale !== null && scale >= 4)}
          onClick={() => setScale(Math.min(4, (scale ?? 1) * 1.5))}
        >
          <ZoomIn />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="适应窗口"
          onClick={() => setScale(null)}
        >
          <Maximize2 />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4">
        {failed ? (
          <p
            role="alert"
            className="p-4 text-center text-sm text-muted-foreground"
          >
            无法显示图片
          </p>
        ) : (
          <div
            className="flex min-h-full min-w-full items-center justify-center"
            style={
              scale !== null && size.width
                ? { width: size.width * scale, height: size.height * scale }
                : { height: "100%" }
            }
          >
            <img
              src={src}
              alt={name}
              referrerPolicy="no-referrer"
              draggable={false}
              onLoad={(event) =>
                setSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
              onError={() => setFailed(true)}
              className={
                scale === null
                  ? "max-h-full max-w-full object-contain"
                  : "max-w-none shrink-0"
              }
              style={
                scale !== null && size.width
                  ? { width: size.width * scale, height: size.height * scale }
                  : undefined
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
