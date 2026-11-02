import { ProgressSection } from "./ProgressCardLayout";
import { useEffect, useState } from "react";
import { useDocumentVisible } from "@/hooks/useDocumentVisible";
import { FileDiff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { call, desktop } from "@/lib/api";
import { changeLabel, type Changes } from "@/lib/files";
import type { OpenProjectFile } from "@/lib/editFiles";
import { cn } from "@/lib/utils";
import { LineChangeCount } from "./LineChangeCount";

/** Mounted only while Git changes are visible. Reads status, never full diffs. */
export function TaskGitOverview({
  project,
  taskId,
  status,
  revision,
  onOpenFile,
  onDetails,
}: {
  project: string;
  taskId: string;
  status: string;
  revision: number;
  onOpenFile?: OpenProjectFile;
  /** Compact sidebar mode; details remain in the existing Git view. */
  onDetails?: () => void;
}) {
  const foreground = useDocumentVisible();
  const [result, setResult] = useState<{
    project: string;
    taskId: string;
    data?: Changes;
    error?: string;
  }>();
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const statsLimit = expanded && !onDetails ? 500 : 4;
  useEffect(() => {
    if (!desktop || !foreground) return;
    let alive = true;
    setBusy(true);
    // Coalesce file events; wait for each read before scheduling another.
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const data = await call<Changes>("project_changes", {
          project,
          taskId,
          statsLimit,
        });
        if (alive)
          setResult((previous) =>
            previous?.project === project &&
            previous.taskId === taskId &&
            !previous.error &&
            JSON.stringify(previous.data) === JSON.stringify(data)
              ? previous
              : { project, taskId, data },
          );
      } catch (error) {
        if (alive) setResult({ project, taskId, error: String(error) });
      } finally {
        if (alive) {
          setBusy(false);
          timer = setTimeout(read, 5000);
        }
      }
    }
    timer = setTimeout(read, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [project, taskId, status, revision, refresh, foreground, statsLimit]);
  const current =
    result?.project === project && result?.taskId === taskId
      ? result
      : undefined;
  const data = current?.data;
  if (!desktop) return null;
  if (data && !data.git)
    return onDetails ? null : (
      <p className="text-xs text-muted-foreground">此目录未使用 Git</p>
    );
  const files = data?.files || [];
  if (onDetails && data && !files.length && !current?.error) return null;
  return (
    <ProgressSection aria-label="Git 改动" className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {onDetails ? (
          <button
            type="button"
            className="flex-1 text-left text-sm hover:text-foreground"
            onClick={onDetails}
          >
            Git 改动
          </button>
        ) : (
          <h3 className="flex-1 font-medium">Git 改动</h3>
        )}
        {data && (
          <span className="tabular-nums">
            {files.length}
            {data.truncated ? "+" : ""} 个文件
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="刷新 Git 改动"
          disabled={busy}
          onClick={() => setRefresh((value) => value + 1)}
        >
          <RefreshCw
            className={cn("size-3", busy && "motion-safe:animate-spin")}
          />
        </Button>
      </div>
      {current?.error ? (
        <p role="alert" className="break-words text-xs text-muted-foreground">
          {current.error}
        </p>
      ) : !data ? (
        <p className="text-xs text-muted-foreground">读取中…</p>
      ) : !files.length ? (
        <p className="text-xs text-muted-foreground">无未提交改动</p>
      ) : (
        <ul className="space-y-0.5">
          {(expanded && !onDetails ? files : files.slice(0, 4)).map((file) => {
            const label = changeLabel(file.status);
            return (
              <li key={file.path}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full justify-start gap-2 px-1 text-xs font-normal"
                  disabled={!onOpenFile && !onDetails}
                  title={file.path}
                  aria-label={`查看 Git 改动：${file.path}`}
                  onClick={() =>
                    onOpenFile
                      ? onOpenFile(
                          project,
                          file.path,
                          "diff",
                          file.originalPath || undefined,
                        )
                      : onDetails?.()
                  }
                >
                  <FileDiff className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {file.path}
                  </span>
                  {label === "冲突" ? (
                    <span className="shrink-0 text-[11px] text-red-700 dark:text-red-400">
                      冲突
                    </span>
                  ) : (
                    <LineChangeCount
                      stats={file.lineStats}
                      title="相对 HEAD 的增删行数"
                    />
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {onDetails && (
        <button
          type="button"
          onClick={onDetails}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          查看 Git 详情
        </button>
      )}
      {!onDetails && files.length > 4 && (
        <Button
          variant="ghost"
          size="xs"
          className="px-1 text-xs text-muted-foreground"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起" : `展开 ${files.length - 4} 个文件`}
        </Button>
      )}
    </ProgressSection>
  );
}
