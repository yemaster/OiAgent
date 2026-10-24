import { useDeferredValue } from "react";
import { Prose } from "./Transcript";
import type { OpenProjectFile } from "@/lib/editFiles";
import "./markdown-preview.css";

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
      className="document-preview h-full min-w-0 overflow-auto bg-card px-6 py-8"
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
