import { useEffect, useState } from "react";
import { FileDiff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { call, desktop } from "@/lib/api";
import { changeLabel, type Changes } from "@/lib/files";
import type { OpenProjectFile } from "@/lib/editFiles";
import { cn } from "@/lib/utils";

/** Mounted only while the overview is visible. Reads status, never full diffs. */
export function TaskGitOverview({
  project,
  taskId,
  status,
  revision,
  onOpenFile,
}: {
  project: string;
  taskId: string;
  status: string;
  revision: number;
  onOpenFile?: OpenProjectFile;
}) {
  const [result, setResult] = useState<{
    project: string;
    data?: Changes;
    error?: string;
  }>();
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    setBusy(true);
    // Coalesce streamed file events and cancel requests for hidden/closed cards.
    const timer = setTimeout(() => {
      void call<Changes>("project_changes", { project, taskId })
        .then((data) => {
          if (alive) setResult({ project, data });
        })
        .catch((error) => {
          if (alive) setResult({ project, error: String(error) });
        })
        .finally(() => {
          if (alive) setBusy(false);
        });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [project, taskId, status, revision, refresh]);
  const current = result?.project === project ? result : undefined;
  const data = current?.data;
  if (!desktop || (data && !data.git)) return null;
  const files = data?.files || [];
  return (
    <section aria-label="Git 改动" className="space-y-2">
      <div className="flex items-center gap-2 pr-6 text-xs text-muted-foreground">
        <h3 className="flex-1 font-medium">Git 改动</h3>
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
          {(expanded ? files : files.slice(0, 4)).map((file) => {
            const label = changeLabel(file.status);
            return (
              <li key={file.path}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full justify-start gap-2 px-1 text-xs font-normal"
                  disabled={!onOpenFile}
                  title={file.path}
                  aria-label={`查看 Git 改动：${file.path}`}
                  onClick={() =>
                    onOpenFile?.(
                      project,
                      file.path,
                      "diff",
                      file.originalPath || undefined,
                    )
                  }
                >
                  <FileDiff className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {file.path}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-[11px]",
                      label === "新增"
                        ? "text-emerald-700 dark:text-emerald-400"
                        : label === "删除" || label === "冲突"
                          ? "text-red-700 dark:text-red-400"
                          : "text-amber-700 dark:text-amber-400",
                    )}
                  >
                    {label}
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {files.length > 4 && (
        <Button
          variant="ghost"
          size="xs"
          className="px-1 text-xs text-muted-foreground"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起" : `展开 ${files.length - 4} 个文件`}
        </Button>
      )}
    </section>
  );
}
