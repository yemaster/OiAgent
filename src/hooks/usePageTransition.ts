import { useLayoutEffect, useRef } from "react";
import { useAnimate, useReducedMotion } from "motion/react";

/** Animate the stable viewport so switching views never remounts live terminals. */
export function usePageTransition(location: string) {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const reducedMotion = useReducedMotion();
  const previous = useRef(location);
  useLayoutEffect(() => {
    if (previous.current === location) return;
    previous.current = location;
    const element = scope.current;
    if (!element || reducedMotion) return;
    let cancelled = false;
    const animation = animate(
      element,
      { opacity: [0.55, 1], y: [4, 0] },
      { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
    );
    void animation.then(() => {
      if (!cancelled) element.style.transform = "none";
    });
    return () => {
      cancelled = true;
      animation.stop();
      element.style.opacity = "1";
      element.style.transform = "none";
    };
  }, [location, reducedMotion, scope, animate]);
  return scope;
}
