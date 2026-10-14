import { Collapsible } from "radix-ui";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function SidebarSection({
  title,
  label = title,
  open,
  onOpenChange,
  actions,
  children,
}: {
  title: string;
  label?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Collapsible.Root
      open={open}
      onOpenChange={onOpenChange}
      role="region"
      aria-label={label}
      className="flex min-h-0 shrink-0 flex-col border-t data-[state=open]:flex-1"
    >
      <div className="flex h-9 shrink-0 items-center gap-1 px-2">
        <Collapsible.Trigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="group min-w-0 flex-1 justify-start gap-1.5 px-1 text-xs font-medium aria-expanded:bg-transparent"
          >
            <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none" />
            <span className="truncate">{title}</span>
          </Button>
        </Collapsible.Trigger>
        {actions}
      </div>
      <Collapsible.Content
        forceMount
        className="flex min-h-0 flex-1 flex-col overflow-hidden data-[state=closed]:hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1 duration-150 motion-reduce:animate-none"
      >
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
