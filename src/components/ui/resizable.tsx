import { Group, Panel, Separator } from "react-resizable-panels";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function ResizablePanelGroup({
  className,
  ...props
}: ComponentProps<typeof Group>) {
  return <Group className={cn("h-full w-full", className)} {...props} />;
}
export const ResizablePanel = Panel;
export function ResizableHandle({
  className,
  ...props
}: ComponentProps<typeof Separator>) {
  return (
    <Separator
      className={cn(
        "relative z-20 shrink-0 bg-border transition-colors hover:bg-primary/50 focus-visible:bg-primary focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}
