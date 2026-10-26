import { lazy, Suspense } from "react";
import type { EditorProps, DiffEditorProps } from "@monaco-editor/react";
import { PaneLoading } from "./PaneLoading";

const MonacoEditor = lazy(() =>
  import("./MonacoSurface").then((m) => ({ default: m.Editor })),
);
const MonacoDiffEditor = lazy(() =>
  import("./MonacoSurface").then((m) => ({ default: m.DiffEditor })),
);

export function Editor(props: EditorProps) {
  return (
    <Suspense fallback={<PaneLoading />}>
      <MonacoEditor {...props} />
    </Suspense>
  );
}

export function DiffEditor(props: DiffEditorProps) {
  return (
    <Suspense fallback={<PaneLoading />}>
      <MonacoDiffEditor {...props} />
    </Suspense>
  );
}
