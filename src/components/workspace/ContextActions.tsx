import { Fragment, type ReactElement, type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export interface ContextAction {
  label: string;
  action: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  separator?: boolean;
}
export function ContextActions({
  children,
  actions,
  onOpen,
}: {
  children: ReactElement;
  actions: ContextAction[];
  onOpen?: () => void;
}) {
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) onOpen?.();
      }}
    >
      <ContextMenuTrigger
        asChild
        className="select-auto"
        onContextMenu={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
            e.preventDefault();
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            e.currentTarget.dispatchEvent(
              new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                clientX: rect.left + 12,
                clientY: rect.top + 12,
                button: 2,
              }),
            );
          }
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        className="min-w-44"
        onContextMenu={(e) => e.preventDefault()}
      >
        {actions.map((item) => (
          <Fragment key={item.label}>
            {item.separator && <ContextMenuSeparator />}
            <ContextMenuItem disabled={item.disabled} onSelect={item.action}>
              {item.icon}
              {item.label}
            </ContextMenuItem>
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
