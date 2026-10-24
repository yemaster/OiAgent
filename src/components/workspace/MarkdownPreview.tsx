import { useDeferredValue } from "react";
import { Prose } from "./Transcript";
import type { OpenProjectFile } from "@/lib/editFiles";

export function MarkdownPreview({
  content,
  project,
  path,
  onOpenFile,
}: {
  content: string;
  project: string;
  path: string;
  onOpenFile?: OpenProjectFile;
}) {
  const text = useDeferredValue(content);
  return (
    <section
      aria-label="Markdown 预览"
      className="h-full min-w-0 overflow-auto bg-card p-5 text-sm leading-7"
    >
      <Prose
        text={text}
        user={false}
        project={project}
        basePath={path}
        onOpenFile={onOpenFile}
      />
    </section>
  );
}
