import type { LineStats } from "@/lib/changeLineStats";

export function LineChangeCount({
  stats,
  title,
}: {
  stats?: LineStats | null;
  title?: string;
}) {
  return stats ? (
    <span
      className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] tabular-nums"
      title={title}
      aria-label={`新增 ${stats.additions} 行，删除 ${stats.deletions} 行`}
    >
      <span className="text-emerald-700 dark:text-emerald-400">
        +{stats.additions}
      </span>
      <span className="text-red-700 dark:text-red-400">-{stats.deletions}</span>
    </span>
  ) : (
    <span
      className="shrink-0 text-[11px] text-muted-foreground"
      title="未记录完整差异，行数未知"
      aria-label="行数未知"
    >
      —
    </span>
  );
}
