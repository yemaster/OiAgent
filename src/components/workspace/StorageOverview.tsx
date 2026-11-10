import { useMemo } from "react";
import { ChevronRight, Info, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  storageCategories,
  storageSize,
  type StorageReport,
} from "@/lib/storage";

// The same chart tokens are used in the application's statistics views.
const colors: Record<string, string> = {
  conversations: "bg-chart-1",
  projects: "bg-chart-4",
  temporary: "bg-chart-2",
  records: "bg-chart-3",
  attachments: "bg-chart-5",
  runtime: "bg-chart-2",
  cache: "bg-chart-3",
  kept: "bg-chart-4",
  other: "bg-chart-5",
};
export function StorageOverview({
  report,
  scanning,
  onAnalyze,
  onManage,
}: {
  report: StorageReport | null;
  scanning: boolean;
  onAnalyze: () => void;
  onManage: (id: string, trigger: HTMLButtonElement) => void;
}) {
  const groups = useMemo(
    () =>
      storageCategories
        .map(([id, title]) => {
          const items =
            report?.items.filter((item) => item.category === id) || [];
          return {
            id,
            title,
            count: items.length,
            bytes: items.reduce((sum, item) => sum + item.bytes, 0),
            partial: items.some((item) => item.partial),
            cleanable: items.some((item) => !item.blockedReason),
          };
        })
        .filter((group) => group.bytes > 0 || group.cleanable || group.partial),
    [report],
  );
  const canClean = report?.items.some((item) => !item.blockedReason);
  return (
    <div className="space-y-4">
      <Card className="gap-0 rounded-lg py-0 shadow-none" aria-busy={scanning}>
        <div className="space-y-5 px-5 pt-5 pb-4 sm:px-6 sm:pt-6">
          <div className="flex items-center justify-between gap-4">
            <div
              className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1"
              aria-live="polite"
            >
              <span className="text-3xl font-medium tracking-tight tabular-nums">
                {report
                  ? `${report.partial ? "≥ " : ""}${storageSize(report.totalBytes)}`
                  : "—"}
              </span>
              <span className="text-sm text-muted-foreground">应用数据</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {report && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="统计范围"
                    >
                      <Info />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-80 p-4 text-xs leading-5"
                  >
                    <p className="font-medium">统计范围</p>
                    <p className="text-muted-foreground">
                      仅统计应用数据目录内的文件大小，不包含安装包、外部项目、Agent
                      原始历史和链接目标。
                    </p>
                    <code className="break-all text-muted-foreground">
                      {report.dataDir}
                    </code>
                  </PopoverContent>
                </Popover>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={scanning}
                aria-label="重新分析"
                title="重新分析"
                onClick={onAnalyze}
              >
                {scanning ? (
                  <LoaderCircle className="motion-safe:animate-spin" />
                ) : (
                  <RefreshCw />
                )}
              </Button>
            </div>
          </div>
          <div
            role="img"
            aria-label="应用数据分类占比"
            className="flex h-2.5 gap-px overflow-hidden rounded-full bg-muted"
          >
            {groups
              .filter((group) => group.bytes > 0)
              .map((group) => (
                <span
                  key={group.id}
                  className={cn("h-full", colors[group.id])}
                  title={`${group.title} · ${storageSize(group.bytes)}`}
                  style={{
                    width: `${(group.bytes / (report?.totalBytes || 1)) * 100}%`,
                  }}
                />
              ))}
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" role="status">
              {scanning ? (
                "正在分析…"
              ) : report ? (
                <>
                  可清理{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    {storageSize(report.cleanableBytes)}
                  </span>
                </>
              ) : (
                "尚未完成分析"
              )}
            </p>
            <Button
              size="sm"
              disabled={scanning || !canClean}
              onClick={(event) => onManage("cleanable", event.currentTarget)}
            >
              清理空间
            </Button>
          </div>
        </div>
        {groups.length > 0 && (
          <div className="border-t px-5 sm:px-6">
            {groups.map((group) => (
              <Button
                key={group.id}
                variant="ghost"
                className="h-auto min-h-12 w-full justify-start gap-3 rounded-none border-0 border-b border-border/60 px-0 py-3 text-left font-normal last:border-b-0 hover:bg-transparent hover:text-primary"
                disabled={scanning}
                aria-label={`${group.title}，${group.count} 项，${storageSize(group.bytes)}，${group.cleanable ? "管理" : "查看"}`}
                onClick={(event) => onManage(group.id, event.currentTarget)}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-2.5 shrink-0 rounded-full",
                    colors[group.id],
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{group.title}</span>
                <span className="text-xs text-muted-foreground">
                  {group.count} 项
                </span>
                <span className="w-20 shrink-0 text-right tabular-nums">
                  {group.partial && "≥ "}
                  {storageSize(group.bytes)}
                </span>
                <ChevronRight className="size-3.5 text-muted-foreground" />
              </Button>
            ))}
          </div>
        )}
        {report && !groups.length && !scanning && (
          <p className="border-t px-6 py-5 text-sm text-muted-foreground">
            暂无存储数据
          </p>
        )}
      </Card>
      {report && (
        <div className="flex items-center justify-between gap-4 px-1 text-sm">
          <span>临时项目自动清理</span>
          <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
            <span>归档 {report.retentionDays} 天后</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="自动清理规则"
                >
                  <Info />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-80 p-4 text-xs leading-5"
              >
                <p>
                  全部任务归档 {report.retentionDays}{" "}
                  天后，下次启动时清理文件，对话记录保留。空项目从创建时起计时。
                </p>
                <p className="text-muted-foreground">
                  已保留项目不自动清理；临时对话在关闭时清理。
                </p>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      )}
      {report?.partial && (
        <p role="status" className="text-xs text-muted-foreground">
          部分数据未能统计，未确认的项目已保护。
        </p>
      )}
    </div>
  );
}
