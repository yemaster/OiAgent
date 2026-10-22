import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { call } from "@/lib/api";

const menus = [
  { id: "file", label: "文件", key: "f" },
  { id: "edit", label: "编辑", key: "e" },
  { id: "view", label: "视图", key: "v" },
  { id: "task", label: "任务", key: "t" },
  { id: "agent", label: "Agent", key: "a" },
  { id: "terminal", label: "终端", key: "r" },
  { id: "window", label: "窗口", key: "w" },
  { id: "help", label: "帮助", key: "h" },
];

export function TitlebarMenu() {
  const bar = useRef<HTMLDivElement>(null);
  const triggers = useRef<(HTMLButtonElement | null)[]>([]);
  const previousFocus = useRef<HTMLElement | null>(null);
  function openMenu(index: number) {
    const button = triggers.current[index];
    if (!button) return;
    // Native editing commands must still target the input or editor, not this trigger.
    if (bar.current?.contains(document.activeElement))
      previousFocus.current?.focus({ preventScroll: true });
    void call("show_application_menu", {
      menuId: menus[index].id,
      x: button.getBoundingClientRect().left,
      y: bar.current?.getBoundingClientRect().bottom ?? 32,
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
            '[data-terminal-surface], [role="dialog"], [role="alertdialog"]',
          ))
      )
        return;
      if (event.key === "Alt") {
        altOnly = true;
        return;
      }
      const index = event.altKey
        ? menus.findIndex((menu) => menu.key === event.key.toLowerCase())
        : -1;
      if (index >= 0) {
        event.preventDefault();
        openMenu(index);
      } else if (event.key === "F10" && !event.altKey) {
        event.preventDefault();
        if (bar.current?.contains(document.activeElement))
          previousFocus.current?.focus();
        else triggers.current[0]?.focus();
      }
    }
    function keyup(event: KeyboardEvent) {
      if (event.key !== "Alt" || !altOnly) return;
      altOnly = false;
      event.preventDefault();
      if (bar.current?.contains(document.activeElement))
        previousFocus.current?.focus();
      else triggers.current[0]?.focus();
    }
    const cancelAlt = () => {
      altOnly = false;
    };
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", cancelAlt);
    window.addEventListener("pointerdown", cancelAlt);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", cancelAlt);
      window.removeEventListener("pointerdown", cancelAlt);
    };
  }, []);
  return (
    <div
      ref={bar}
      role="menubar"
      aria-label="应用菜单"
      className="flex h-full shrink-0 items-center"
      onFocusCapture={(event) => {
        if (
          event.relatedTarget instanceof HTMLElement &&
          !bar.current?.contains(event.relatedTarget)
        )
          previousFocus.current = event.relatedTarget;
      }}
    >
      {menus.map((menu, index) => (
        <Button
          key={menu.id}
          ref={(element) => {
            triggers.current[index] = element;
          }}
          role="menuitem"
          aria-haspopup="menu"
          tabIndex={index === 0 ? 0 : -1}
          aria-keyshortcuts={`Alt+${menu.key.toUpperCase()}`}
          variant="ghost"
          size="xs"
          className="h-7 rounded-sm px-2 text-xs font-normal"
          onPointerDown={(event) => {
            if (event.button === 0) event.preventDefault();
          }}
          onClick={() => openMenu(index)}
          onKeyDown={(event) => {
            const next =
              event.key === "ArrowRight"
                ? (index + 1) % menus.length
                : event.key === "ArrowLeft"
                  ? (index + menus.length - 1) % menus.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? menus.length - 1
                      : -1;
            if (next >= 0) {
              event.preventDefault();
              triggers.current[next]?.focus();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              openMenu(index);
            } else if (event.key === "Escape") {
              event.preventDefault();
              previousFocus.current?.focus();
            }
          }}
        >
          {menu.label}
        </Button>
      ))}
    </div>
  );
}
