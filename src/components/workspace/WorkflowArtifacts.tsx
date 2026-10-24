import { useTaskArtifacts } from "@/hooks/useTaskArtifacts";
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
import { Input } from "@/components/ui/input";
import { CodeBlock, MarkdownCodeBlock } from "./CodeBlock";
import { call } from "@/lib/api";
import { language } from "@/lib/files";
import type { OpenProjectFile } from "@/lib/editFiles";
import { isActive, type Task } from "@/lib/types";
import type { WorkflowRun } from "@/lib/workflows";
import { cn } from "@/lib/utils";

type Preview = { content: string; truncated: boolean; revision: string };

export function WorkflowArtifacts({
  run,
  task,
  onOpenFile,
  active,
}: {
  active: boolean;
  onOpenFile?: OpenProjectFile;
} & ({ run: WorkflowRun; task?: never } | { task: Task; run?: never })) {
  const [selection, setSelected] = useState("");
  const [detail, setDetail] = useState<{
    key: string;
    data?: Preview;
    error?: string;
  }>();
  const [source, setSource] = useState(false);
  const [query, setQuery] = useState("");
  const id = run?.id ?? task!.id;
  const revision = run?.revision ?? task!.updatedAt;
  const command = run || task?.source === "workflow" ? "workflow" : "task";
  const listing = useTaskArtifacts(
    command,
    id,
    active,
    revision,
    task ? isActive(task) : ["running", "waiting"].includes(run!.status),
  );
  const files = listing.data;
  const selected = files?.files.some((file) => file.path === selection)
    ? selection
    : files?.files.find((file) => !file.error)?.path ||
      files?.files[0]?.path ||
      "";
  const requestKey = `${command}:${id}:${revision}:${listing.revision}`;
  // Keep the selected file visible while a background refresh is in flight.
  const previewKey = `${command}:${id}:${selected}`;
  const loading = listing.loading;
  const error = listing.error;
  const preview = detail?.key === previewKey ? detail.data : undefined;
  const fileError = detail?.key === previewKey ? detail.error : undefined;
  useEffect(() => {
    if (!active || !selected) return;
    let disposed = false;
    void call<Preview>(`${command}_artifact`, { id, path: selected })
      .then((value) => {
        if (!disposed) setDetail({ key: previewKey, data: value });
      })
      .catch((error) => {
        if (!disposed) setDetail({ key: previewKey, error: String(error) });
      });
    return () => {
      disposed = true;
    };
  }, [active, id, command, selected, requestKey, previewKey]);
  const current = files?.files.find((file) => file.path === selected);
  const matchingFiles = files?.files.filter((file) =>
    [
      file.relativePath,
      ...file.stepIds.map(
        (id) =>
          run?.definition.steps.find((step) => step.id === id)?.title || "",
      ),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const markdown = /\.(md|markdown)$/i.test(selected);
  async function fileAction(action: "reveal" | "open") {
    if (!current) return;
    try {
      await call("system_file_action", {
        project: current.project,
        path: current.relativePath,
        action,
      });
    } catch (error) {
      setDetail({ key: previewKey, error: String(error) });
    }
  }
  return (
    <section
      aria-label={command === "workflow" ? "工作流产物" : "对话产物"}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
        <span className="text-xs text-muted-foreground">
          {files ? `${files.files.length} 个文件` : "文件"}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="刷新产物"
          disabled={loading}
          onClick={() => void listing.refresh()}
        >
          <RefreshCw className={cn(loading && "animate-spin")} />
        </Button>
      </div>
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
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <div className="flex min-h-0 shrink-0 flex-col border-b sm:w-48 sm:border-r sm:border-b-0">
            {(files.files.length > 5 || query) && (
              <div className="shrink-0 px-3 py-2">
                <Input
                  aria-label="查找产物"
                  placeholder={run ? "查找文件或步骤…" : "查找文件…"}
                  className="h-8"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            )}
            <nav
              aria-label="产物文件"
              className="max-h-40 overflow-y-auto p-2 sm:max-h-none sm:flex-1"
            >
              {matchingFiles?.map((file) => (
                <button
                  key={file.path}
                  aria-current={selected === file.path ? "true" : undefined}
                  className={cn(
                    "mb-0.5 flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
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
                      {file.error
                        ? "不可读取"
                        : file.stepIds
                            .map(
                              (id) =>
                                run?.definition.steps.find(
                                  (step) => step.id === id,
                                )?.title,
                            )
                            .filter(Boolean)
                            .join("、")}
                    </span>
                  </span>
                </button>
              ))}
              {!matchingFiles?.length && (
                <p className="p-2 text-xs text-muted-foreground">
                  没有匹配文件
                </p>
              )}
              {files.truncated && (
                <p className="p-2 text-xs text-muted-foreground">
                  仅显示前 {files.files.length} 个文件
                </p>
              )}
            </nav>
          </div>
          <section
            aria-label="产物预览"
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            {current && (
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-3">
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
                        }}
                      >
                        <Pencil />
                        编辑
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => void fileAction("open")}
                    >
                      系统打开
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="在文件夹中显示"
                      onClick={() => void fileAction("reveal")}
                    >
                      <SquareArrowOutUpRight />
                    </Button>
                  </>
                )}
              </div>
            )}
            <div
              className={cn(
                "min-h-0 flex-1 p-4 sm:p-6",
                markdown && !source && !fileError
                  ? "overflow-auto"
                  : "flex flex-col overflow-hidden",
              )}
            >
              {fileError ? (
                <p
                  role="alert"
                  className="flex flex-1 items-center justify-center break-words text-center text-sm text-muted-foreground"
                >
                  {fileError}
                </p>
              ) : !preview ? (
                <p role="status" className="text-muted-foreground">
                  正在读取…
                </p>
              ) : (
                <>
                  {preview.truncated && (
                    <p className="mb-4 shrink-0 text-xs text-muted-foreground">
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
                      fill
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
    </section>
  );
}
