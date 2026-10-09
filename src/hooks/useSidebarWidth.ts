import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

const key = "oiagent-sidebar-width";
const min = 208,
  max = 420,
  initial = 256;
const clamp = (value: number) => Math.max(min, Math.min(max, value));

export function useSidebarWidth() {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(key));
      return saved > 0 && Number.isFinite(saved) ? clamp(saved) : initial;
    } catch {
      return initial;
    }
  });
  const [dragging, setDragging] = useState(false);
  const origin = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(key, String(width));
    } catch {
      /* Keep resizing available. */
    }
  }, [width]);
  useEffect(() => {
    if (!dragging) return;
    const cursor = document.body.style.cursor;
    const selection = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = selection;
    };
  }, [dragging]);
  const stop = () => {
    origin.current = null;
    setDragging(false);
  };
  return {
    width,
    separator: {
      role: "separator" as const,
      tabIndex: 0,
      "aria-label": "调整侧边栏宽度",
      "aria-orientation": "vertical" as const,
      "aria-valuemin": min,
      "aria-valuemax": max,
      "aria-valuenow": width,
      "aria-valuetext": `${width} 像素`,
      title: "拖动调整宽度，双击恢复默认",
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        origin.current = {
          x: event.clientX,
          width:
            event.currentTarget.parentElement?.getBoundingClientRect().width ||
            width,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        if (origin.current)
          setWidth(
            clamp(origin.current.width + event.clientX - origin.current.x),
          );
      },
      onPointerUp: stop,
      onPointerCancel: stop,
      onLostPointerCapture: stop,
      onDoubleClick: () => setWidth(initial),
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        setWidth((value) =>
          event.key === "Home"
            ? min
            : event.key === "End"
              ? max
              : clamp(value + (event.key === "ArrowRight" ? 16 : -16)),
        );
      },
    },
  };
}
