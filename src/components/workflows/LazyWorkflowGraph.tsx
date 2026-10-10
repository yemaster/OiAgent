import { lazy, Suspense, type ComponentProps } from "react";
const Graph = lazy(() =>
  import("./WorkflowGraph").then((module) => ({
    default: module.WorkflowGraph,
  })),
);
export function WorkflowGraph(props: ComponentProps<typeof Graph>) {
  return (
    <Suspense
      fallback={
        <div className="flex h-[480px] items-center justify-center rounded-lg border text-sm text-muted-foreground">
          正在加载画布…
        </div>
      }
    >
      <Graph {...props} />
    </Suspense>
  );
}
