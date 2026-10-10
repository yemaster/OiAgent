import { lazy, Suspense, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
const Graph = lazy(() =>
  import("./WorkflowGraph").then((module) => ({
    default: module.WorkflowGraph,
  })),
);
export function WorkflowGraph(props: ComponentProps<typeof Graph>) {
  return (
    <Suspense
      fallback={
        <div
          className={cn(
            "flex h-[480px] items-center justify-center rounded-lg border text-sm text-muted-foreground",
            props.className,
          )}
        >
          正在加载画布…
        </div>
      }
    >
      <Graph {...props} />
    </Suspense>
  );
}
