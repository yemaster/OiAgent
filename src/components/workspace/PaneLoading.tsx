import { LoaderCircle } from "lucide-react";

export function PaneLoading() {
  return (
    <div
      role="status"
      aria-label="正在加载"
      className="flex h-full min-h-0 items-center justify-center text-muted-foreground"
    >
      <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" />
    </div>
  );
}
