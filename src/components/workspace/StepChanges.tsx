import { lazy, Suspense, useMemo, useState } from "react";
import {
  FileDiff,
  FilePlus2,
  FileMinus2,
  FilePenLine,
  ArrowRightLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { StepChange } from "@/lib/stepChanges";
import type { OpenProjectFile } from "@/lib/editFiles";
const Preview = lazy(() => import("./StepChangePreview"));
const labels = { edit: "修改", add: "新增", delete: "删除", rename: "重命名" };
const icons = {
  edit: FilePenLine,
  add: FilePlus2,
  delete: FileMinus2,
  rename: ArrowRightLeft,
};

export function StepChanges({
  changes,
  project,
  initialPath,
  onOpen,
}: {
  changes: StepChange[];
  project: string;
  initialPath?: string;
  onOpen?: OpenProjectFile;
}) {
  const [path, setPath] = useState(initialPath);
  const [selectedStep, setStep] = useState<string>();
  const groups = useMemo(() => {
    const result = new Map<string, StepChange[]>();
    for (const change of changes) {
      const key = change.relativePath || change.path;
      const rows = result.get(key) || [];
      rows.push(change);
      result.set(key, rows);
    }
    return [...result.entries()];
  }, [changes]);
  const group = groups.find(([key]) => key === path) || groups[0];
  const rows = group?.[1] || [];
  const current = rows.find((row) => row.id === selectedStep) || rows.at(-1);
  if (!current)
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        暂无文件改动记录
      </div>
    );
  return (
    <div
      className="flex min-h-0 flex-1 flex-col sm:flex-row"
      aria-label="Agent 单步改动"
    >
      <nav
        aria-label="改动文件"
        className="flex max-h-32 shrink-0 flex-col overflow-auto border-b p-2 sm:max-h-none sm:w-52 sm:border-b-0 sm:border-r"
      >
        {groups.map(([key, entries]) => {
          const last = entries.at(-1)!;
          const Icon = icons[last.operation] || FileDiff;
          return (
            <Button
              key={key}
              variant="navigation"
              className="h-auto min-h-10 w-full justify-start gap-2 px-2 py-2 text-left"
              data-active={key === group?.[0]}
              aria-pressed={key === group?.[0]}
              title={key}
              onClick={() => {
                setPath(key);
                setStep(undefined);
              }}
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs">
                  {key.split(/[\\/]/).at(-1)}
                </span>
                <span className="block truncate text-[11px] font-normal text-muted-foreground">
                  {key}
                </span>
              </span>
              {entries.length > 1 && (
                <span className="text-[11px] text-muted-foreground">
                  {entries.length}
                </span>
              )}
            </Button>
          );
        })}
      </nav>
      <section
        className="flex min-h-0 min-w-0 flex-1 flex-col"
        aria-label="改动预览"
      >
        <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
          <span
            className="min-w-0 flex-1 truncate text-xs"
            title={current.path}
          >
            {current.originalPath ? `${current.originalPath} → ` : ""}
            {current.relativePath || current.path}
          </span>
          {rows.length > 1 ? (
            <Select value={current.id} onValueChange={setStep}>
              <SelectTrigger
                className="h-7 max-w-52 text-xs"
                aria-label="选择修改步骤"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {rows.map((row, index) => (
                  <SelectItem key={row.id} value={row.id}>
                    {`第 ${index + 1} 次 · ${labels[row.operation]}${row.timestamp && !Number.isNaN(Date.parse(row.timestamp)) ? ` · ${new Date(row.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-xs text-muted-foreground">
              {labels[current.operation]}
            </span>
          )}
          {onOpen && current.relativePath && current.operation !== "delete" && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => onOpen(project, current.relativePath!, "edit")}
            >
              打开文件
            </Button>
          )}
        </header>
        <Suspense
          fallback={
            <p className="p-4 text-xs text-muted-foreground">加载差异…</p>
          }
        >
          <Preview key={current.id} change={current} />
        </Suspense>
      </section>
    </div>
  );
}
