import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/** Measure only real size changes, never every React render or animation frame. */
export function ProgressCardLayout({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const root = outer.current;
    const content = inner.current;
    if (!root || !content) return;
    let frame = 0;
    let height: number | undefined;
    let nextHeight = 0;
    let positions = new Map<HTMLElement, number>();
    const animations = new Map<HTMLElement, Animation>();
    const timing = { duration: 200, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };
    const observer = new ResizeObserver(([entry]) => {
      nextHeight =
        entry?.borderBoxSize?.[0]?.blockSize ?? entry?.contentRect.height;
      if (!Number.isFinite(nextHeight) || nextHeight <= 0 || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const next = nextHeight + root.offsetHeight - root.clientHeight;
        if (height === next) return;
        const previous =
          height === undefined ? next : root.getBoundingClientRect().height;
        const sections = new Map(
          Array.from(
            content.querySelectorAll<HTMLElement>("[data-progress-section]"),
            (section) => [section, section.offsetTop],
          ),
        );
        for (const animation of animations.values()) animation.cancel();
        animations.clear();
        root.style.height = `${next}px`;
        if (
          height !== undefined &&
          !reduced &&
          typeof root.animate === "function"
        ) {
          animations.set(
            root,
            root.animate(
              [{ height: `${previous}px` }, { height: `${next}px` }],
              timing,
            ),
          );
          for (const [section, top] of sections) {
            const old = positions.get(section);
            if (old !== undefined && old !== top)
              animations.set(
                section,
                section.animate(
                  [
                    { transform: `translateY(${old - top}px)` },
                    { transform: "translateY(0)" },
                  ],
                  timing,
                ),
              );
          }
        }
        height = next;
        positions = sections;
      });
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      for (const animation of animations.values()) animation.cancel();
      root.style.height = "";
    };
  }, [reduced]);
  return (
    <div ref={outer} className={cn("contain-layout", className)}>
      <div ref={inner} className="relative">
        {children}
      </div>
    </div>
  );
}
export function ProgressSection(props: React.ComponentProps<"section">) {
  return <section data-progress-section {...props} />;
}
