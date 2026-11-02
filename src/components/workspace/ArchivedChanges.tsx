import { useEffect, useMemo, useState } from "react";
import { call } from "@/lib/api";
import type { Message } from "@/lib/types";
import { buildTranscript } from "@/lib/transcript";
import { conversationChanges, type StepChange } from "@/lib/stepChanges";
import type { OpenProjectFile } from "@/lib/editFiles";
import { Button } from "@/components/ui/button";
import { StepChanges } from "./StepChanges";

type Page = {
  messages: Message[];
  total: number;
  next: number | null;
  omitted: boolean;
};
export function ArchivedChanges({
  id,
  compact = false,
  initialPath,
  archive = true,
  project,
  active,
  live,
  fallback,
  onOpen,
}: {
  compact?: boolean;
  initialPath?: string;
  id: string;
  archive?: boolean;
  project: string;
  active: boolean;
  live: boolean;
  fallback: StepChange[];
  onOpen?: OpenProjectFile;
}) {
  const [cursors, setCursors] = useState<(number | null)[]>([null]);
  const before = cursors.at(-1) ?? null;
  const [page, setPage] = useState<Page>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!archive) {
      // Remote/demo views have no archive request to synchronize.
      // oxlint-disable-next-line react/set-state-in-effect
      setLoading(false);
      return;
    }
    if (!active) {
      setPage(undefined);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setPage(undefined);
    setLoading(true);
    async function load() {
      try {
        const result = await call<Page>("task_changes", { id, before });
        if (!Array.isArray(result?.messages))
          throw new Error("无法读取历史差异");
        if (!cancelled) {
          setPage(result);
          setError("");
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (live && before === null) timer = setTimeout(load, 3000);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, before, active, live, retry, archive]);
  const changes = useMemo(
    () =>
      page
        ? conversationChanges(buildTranscript(page.messages), project)
        : fallback,
    [page, project, fallback],
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1 text-xs text-muted-foreground">
        <span className="mr-auto" role="status">
          {loading
            ? "读取历史差异…"
            : page
              ? `共 ${page.total} 次修改 · ${before === null ? "最近记录" : "历史记录"}`
              : "当前消息中的改动"}
        </span>
        <Button
          variant="ghost"
          size="xs"
          disabled={loading || cursors.length === 1}
          onClick={() => setCursors(cursors.slice(0, -1))}
        >
          较新改动
        </Button>
        <Button
          variant="ghost"
          size="xs"
          disabled={loading || page?.next == null}
          onClick={() => {
            if (page?.next != null) setCursors([...cursors, page.next]);
          }}
        >
          更早改动
        </Button>
      </div>
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 px-3 py-2 text-xs text-destructive"
        >
          <span>{error}</span>
          <Button size="xs" variant="ghost" onClick={() => setRetry(retry + 1)}>
            重试
          </Button>
        </div>
      )}
      {page?.omitted && (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          部分记录过大，未载入预览；原始记录仍保存在磁盘。
        </p>
      )}
      <StepChanges
        initialPath={initialPath}
        compact={compact}
        key={`${id}:${before}`}
        changes={changes}
        project={project}
        onOpen={onOpen}
      />
    </div>
  );
}
