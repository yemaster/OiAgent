import { Children, type ReactNode } from "react";

// Anonymous flex text cannot ellipsize. Keep icons/shortcuts intact and give
// plain action labels a shrinkable, single-line box with their full native tooltip.
export function menuLabel(children: ReactNode) {
  return Children.map(children, (child) =>
    typeof child === "string" || typeof child === "number" ? (
      <span className="min-w-0 truncate" title={String(child)}>
        {child}
      </span>
    ) : (
      child
    ),
  );
}
