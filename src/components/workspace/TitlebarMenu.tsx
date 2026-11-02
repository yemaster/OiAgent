import { useEffect, useRef } from "react";
import { Menu } from "lucide-react";
import { toast } from "sonner";
import { call } from "@/lib/api";
import { IconButton } from "./shared";

const accessKeys: Record<string, string> = {
  f: "file",
  e: "edit",
  v: "view",
  t: "task",
  a: "agent",
  r: "terminal",
  w: "window",
  h: "help",
};

/** Compact menu in the activity bar; native items retain their enabled states and editing targets. */
export function TitlebarMenu() {
  const trigger = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  function open(menuId = "application") {
    if (document.activeElement === trigger.current)
      previousFocus.current?.focus({ preventScroll: true });
    const rect = trigger.current?.getBoundingClientRect();
    void call("show_application_menu", {
      menuId,
      x: rect?.right ?? 0,
      y: rect?.top ?? 0,
    }).catch((error) => toast.error(String(error)));
  }
  useEffect(() => {
    let altOnly = false;
    function keydown(event: KeyboardEvent) {
      if (event.key !== "Alt") altOnly = false;
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.target instanceof Element &&
          event.target.closest(
            '[data-terminal-surface], [role="dialog"], [role="alertdialog"], [data-shortcut-recorder]',
          ))
      )
        return;
      if (event.key === "Alt") {
        altOnly = true;
        return;
      }
      const menu = event.altKey
        ? accessKeys[event.key.toLowerCase()]
        : undefined;
      if (menu) {
        event.preventDefault();
        open(menu);
      } else if (event.key === "F10" && !event.altKey) {
        event.preventDefault();
        trigger.current?.focus();
      }
    }
    function keyup(event: KeyboardEvent) {
      if (event.key === "Alt" && altOnly) {
        altOnly = false;
        event.preventDefault();
        if (document.activeElement === trigger.current)
          previousFocus.current?.focus();
        else trigger.current?.focus();
      }
    }
    const cancel = () => {
      altOnly = false;
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", cancel);
    window.addEventListener("pointerdown", cancel);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("pointerdown", cancel);
    };
  }, []);
  return (
    <IconButton
      ref={trigger}
      label="应用菜单"
      tooltipSide="right"
      aria-haspopup="menu"
      className="mb-1 rounded-md text-[var(--sidebar-icon)] hover:text-sidebar-foreground"
      onFocus={(event) => {
        if (event.relatedTarget instanceof HTMLElement)
          previousFocus.current = event.relatedTarget;
      }}
      onPointerDown={(event) => {
        if (event.button === 0) event.preventDefault();
      }}
      onClick={() => open()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          previousFocus.current?.focus();
        } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          open();
        }
      }}
    >
      <Menu />
    </IconButton>
  );
}
