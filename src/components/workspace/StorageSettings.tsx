import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { call, desktop } from "@/lib/api";
import {
  storageCategories,
  type StorageDeleteResult,
  type StorageItem,
  type StorageReport,
} from "@/lib/storage";
import { StorageOverview } from "./StorageOverview";
import { StorageManager } from "./StorageManager";

export function StorageSettings({
  openProjects,
  onDeleted,
  onOpenArchive,
}: {
  openProjects: string[];
  onDeleted: (ids: string[], projects: string[]) => Promise<void>;
  onOpenArchive: () => void;
}) {
  const [report, setReport] = useState<StorageReport | null>(null);
  const [scanning, setScanning] = useState(desktop);
  const [error, setError] = useState("");
  const [failures, setFailures] = useState<string[]>([]);
  const [manager, setManager] = useState<{
    id: string;
    title: string;
    session: number;
  } | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const session = useRef(0);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const current = useRef({ openProjects, onDeleted });
  const mounted = useRef(false);
  const scanRequest = useRef<Promise<StorageReport> | null>(null);
  useLayoutEffect(() => {
    current.current = { openProjects, onDeleted };
  });

  async function readReport() {
    try {
      scanRequest.current ??= call<StorageReport>("scan_storage", {
        openProjects: current.current.openProjects,
      });
      const result = await scanRequest.current;
      if (mounted.current) setReport(result);
    } catch (error) {
      if (mounted.current) {
        setReport(null);
        setError(String(error));
      }
    } finally {
      scanRequest.current = null;
      if (mounted.current) setScanning(false);
    }
  }
  function analyze() {
    setScanning(true);
    setError("");
    return readReport();
  }
  useEffect(() => {
    mounted.current = true;
    if (desktop) void readReport();
    return () => {
      mounted.current = false;
    };
  }, []);
  const managerItems = useMemo(
    () =>
      report?.items.filter((item) =>
        manager?.id === "cleanable"
          ? !item.blockedReason
          : item.category === manager?.id,
      ) || [],
    [report, manager],
  );

  async function remove(chosen: StorageItem[]) {
    const result = await call<StorageDeleteResult>("delete_storage_items", {
      items: chosen.map(({ id, revision }) => ({ id, revision })),
      openProjects: current.current.openProjects,
      confirmed: true,
    });
    if (mounted.current) {
      setManagerOpen(false);
      setFailures(
        result.failures.map(
          ({ id, message }) =>
            `${chosen.find((item) => item.id === id)?.name || id}：${message}`,
        ),
      );
    }
    if (result.deletedItems.length)
      toast.success(`已删除 ${result.deletedItems.length} 项`);
    let refreshError = "";
    // Refresh even after partial cleanup: files may be staged before a later failure.
    try {
      await current.current.onDeleted(
        result.deletedIds,
        result.deletedProjects,
      );
    } catch (error) {
      refreshError = `任务列表刷新失败：${String(error)}`;
    }
    if (mounted.current) {
      await analyze();
      if (refreshError) setError(refreshError);
    }
  }

  if (!desktop)
    return (
      <p className="text-sm text-muted-foreground">
        存储空间分析需要在桌面版中使用。
      </p>
    );
  return (
    <div ref={root} tabIndex={-1} className="space-y-4 outline-none">
      <StorageOverview
        report={report}
        scanning={scanning}
        onAnalyze={() => void analyze()}
        onManage={(id, trigger) => {
          returnFocus.current = trigger;
          setManager({
            id,
            title:
              id === "cleanable"
                ? "清理空间"
                : storageCategories.find(([key]) => key === id)?.[1] ||
                  "存储项目",
            session: ++session.current,
          });
          setManagerOpen(true);
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {failures.length > 0 && (
        <div role="alert" className="space-y-1 text-sm text-destructive">
          <p>部分项目未完成清理</p>
          <ul className="max-h-40 list-disc overflow-auto pl-4">
            {failures.map((failure) => (
              <li key={failure}>{failure}</li>
            ))}
          </ul>
        </div>
      )}
      {report && manager && (
        <StorageManager
          key={manager.session}
          open={managerOpen}
          title={manager.title}
          dataDir={report.dataDir}
          items={managerItems}
          onOpenChange={setManagerOpen}
          onDelete={remove}
          onArchive={
            manager.id === "records"
              ? () => {
                  setManagerOpen(false);
                  onOpenArchive();
                }
              : undefined
          }
          onReturnFocus={() => {
            const trigger = returnFocus.current;
            if (trigger?.isConnected && !trigger.disabled) trigger.focus();
            else root.current?.focus();
          }}
        />
      )}
    </div>
  );
}
