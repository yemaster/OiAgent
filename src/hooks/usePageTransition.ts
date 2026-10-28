import { useLayoutEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

/** Animate the existing viewport, never remount editors or live terminals. */
export function usePageTransition(location: string) {
  const scope = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const previous = useRef(location);
  useLayoutEffect(() => {
    if (previous.current === location) return;
    previous.current = location;
    const element = scope.current;
    if (!element || reducedMotion || typeof element.animate !== "function")
      return;
    // The browser owns this compositor animation: no per-frame React/JS work,
    // inline-style residue, or completion callbacks racing the next navigation.
    const animation = element.animate(
      [
        { opacity: 0.7, transform: "translateY(3px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 160, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    return () => animation.cancel();
  }, [location, reducedMotion]);
  return scope;
}
