import { useEffect, useState } from "react";
import {
  FileText,
  RefreshCw,
  SquareArrowOutUpRight,
  Pencil,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { CodeBlock, MarkdownCodeBlock } from "./CodeBlock";
import { call } from "@/lib/api";
import { language } from "@/lib/files";
import type { OpenProjectFile } from "@/lib/editFiles";
import type { WorkflowRun } from "@/lib/workflows";
import { cn } from "@/lib/utils";

type Artifact = {
  path: string;
  project: string;
  relativePath: string;
  stepIds: string[];
  size: number;
  error: string | null;
};
type ArtifactList = { files: Artifact[]; truncated: boolean };
type Preview = { content: string; truncated: boolean; revision: string };

export function WorkflowArtifacts({
  run,
  onOpenFile,
}: {
  run: WorkflowRun;
  onOpenFile?: OpenProjectFile;
}) {
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<{
    key: string;
    data?: ArtifactList;
    error?: string;
  }>();
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<{
    key: string;
    data?: Preview;
    error?: string;
  }>();
  const [refresh, setRefresh] = useState(0);
  const [source, setSource] = useState(false);
  const requestKey = `${run.id}:${run.revision}:${refresh}`;
  const previewKey = `${requestKey}:${selected}`;
  const files = listing?.data;
  const loading = open && listing?.key !== requestKey;
  const error = listing?.key === requestKey ? listing.error : undefined;
  const preview = detail?.key === previewKey ? detail.data : undefined;
  const fileError = detail?.key === previewKey ? detail.error : undefined;
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    void call<ArtifactList>("workflow_artifacts", { id: run.id })
      .then((value) => {
        if (disposed) return;
        setListing({ key: requestKey, data: value });
        setSelected((old) =>
          value.files.some((file) => file.path === old)
            ? old
            : value.files[0]?.path || "",
        );
      })
      .catch((error) => {
        if (!disposed) setListing({ key: requestKey, error: String(error) });
      });
    return () => {
      disposed = true;
    };
  }, [open, run.id, requestKey]);
  useEffect(() => {
    if (!open || !selected || listing?.key !== requestKey) return;
    let disposed = false;
    void call<Preview>("workflow_artifact", { id: run.id, path: selected })
      .then((value) => {
        if (!disposed) setDetail({ key: previewKey, data: value });
      })
      .catch((error) => {
        if (!disposed) setDetail({ key: previewKey, error: String(error) });
      });
    return () => {
      disposed = true;
    };
  }, [open, run.id, selected, listing?.key, requestKey, previewKey]);
  const current = files?.files.find((file) => file.path === selected);
  const markdown = /\.(md|markdown)$/i.test(selected);
  async function reveal() {
    if (!current) return;
    try {
      await call("system_file_action", {
        project: current.project,
        path: current.relativePath,
        action: "reveal",
      });
    } catch (error) {
      setDetail({ key: previewKey, error: String(error) });
    }
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) setRefresh((n) => n + 1);
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <FileText />
          产物
        </Button>
      </SheetTrigger>
      <SheetContent
        aria-describedby={undefined}
        className="gap-0 data-[side=right]:w-[min(960px,96vw)] data-[side=right]:sm:max-w-none"
      >
        <SheetHeader className="flex-row items-center gap-3 border-b pr-14">
          <SheetTitle className="flex-1">产物</SheetTitle>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="刷新产物"
            disabled={loading}
            onClick={() => setRefresh((n) => n + 1)}
          >
            <RefreshCw className={cn(loading && "animate-spin")} />
          </Button>
        </SheetHeader>
        {error && (
          <p role="alert" className="p-4 text-destructive">
            {error}
          </p>
        )}
        {!files && loading ? (
          <p role="status" className="p-6 text-muted-foreground">
            正在读取…
          </p>
        ) : !files?.files.length ? (
          <p className="p-6 text-muted-foreground">暂无产物</p>
        ) : (
          <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] sm:grid-cols-[220px_minmax(0,1fr)] sm:grid-rows-1">
            <nav
              aria-label="产物文件"
              className="max-h-44 overflow-y-auto border-b bg-muted/20 p-2 sm:max-h-none sm:border-r sm:border-b-0"
            >
              {files.files.map((file) => (
                <button
                  key={file.path}
                  aria-current={selected === file.path ? "true" : undefined}
                  className={cn(
                    "mb-1 flex w-full items-start gap-2 rounded-md p-2 text-left transition-colors",
                    selected === file.path
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50",
                  )}
                  onClick={() => {
                    setSelected(file.path);
                    setSource(false);
                  }}
                  title={file.path}
                >
                  <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {file.path.split(/[\\/]/).at(-1)}
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {file.stepIds
                        .map(
                          (id) =>
                            run.definition.steps.find((step) => step.id === id)
                              ?.title,
                        )
                        .filter(Boolean)
                        .join("、")}
                    </span>
                  </span>
                </button>
              ))}
              {files.truncated && (
                <p className="p-2 text-xs text-muted-foreground">
                  仅显示前 32 个文件
                </p>
              )}
            </nav>
            <section
              aria-label="产物预览"
              className="flex min-h-0 min-w-0 flex-col"
            >
              {current && (
                <div className="flex flex-wrap items-center gap-2 border-b p-3">
                  <span
                    className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                    title={current.path}
                  >
                    {current.relativePath}
                  </span>
                  {markdown && preview && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setSource((value) => !value)}
                    >
                      {source ? "预览" : "源码"}
                    </Button>
                  )}
                  {!current.error && (
                    <>
                      {onOpenFile && preview && (
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => {
                            onOpenFile(current.project, current.relativePath);
                            setOpen(false);
                          }}
                        >
                          <Pencil />
                          编辑
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="在文件夹中显示"
                        onClick={() => void reveal()}
                      >
                        <SquareArrowOutUpRight />
                      </Button>
                    </>
                  )}
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
                {fileError ? (
                  <p role="alert" className="text-sm text-muted-foreground">
                    {fileError}
                  </p>
                ) : !preview ? (
                  <p role="status" className="text-muted-foreground">
                    正在读取…
                  </p>
                ) : (
                  <>
                    {preview.truncated && (
                      <p className="mb-4 text-xs text-muted-foreground">
                        内容较长，仅预览前 256 KB
                      </p>
                    )}
                    {markdown && !source ? (
                      <div className="markdown break-words text-sm leading-7">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            pre: MarkdownCodeBlock,
                            img: ({ alt }) => <span>[{alt || "图片"}]</span>,
                            a: ({ children }) => (
                              <span className="underline">{children}</span>
                            ),
                          }}
                        >
                          {preview.content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <CodeBlock
                        text={preview.content}
                        language={language(selected)}
                        label={selected.split(/[\\/]/).at(-1)}
                      />
                    )}
                  </>
                )}
              </div>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
