import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
const PAGE_LINES = 400;
function patchRows(patch: string) {
  let oldLine: number | undefined;
  let newLine: number | undefined;
  let inHunk = false;
  const result: { text: string; kind: string; old?: number; next?: number }[] =
    [];
  for (const text of patch.split("\n")) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (text.startsWith("@@") || text.startsWith("*** ")) {
      inHunk = text.startsWith("@@");
      oldLine = header ? Number(header[1]) : undefined;
      newLine = header ? Number(header[2]) : undefined;
      result.push({ text, kind: "header" });
      continue;
    }
    const kind =
      text.startsWith("+") && (inHunk || !text.startsWith("+++ "))
        ? "add"
        : text.startsWith("-") && (inHunk || !text.startsWith("--- "))
          ? "delete"
          : text.startsWith(" ")
            ? "context"
            : "header";
    const row = {
      text,
      kind,
      old: kind === "delete" || kind === "context" ? oldLine : undefined,
      next: kind === "add" || kind === "context" ? newLine : undefined,
    };
    if ((kind === "delete" || kind === "context") && oldLine !== undefined)
      oldLine++;
    if ((kind === "add" || kind === "context") && newLine !== undefined)
      newLine++;
    result.push(row);
  }
  return result;
}
export function PatchPreview({ patch }: { patch: string }) {
  const [page, setPage] = useState(0);
  const rows = useMemo(() => patchRows(patch), [patch]);
  const current = Math.min(
    page,
    Math.max(0, Math.ceil(rows.length / PAGE_LINES) - 1),
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-label="本次补丁">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1 text-xs">
        <span className="text-muted-foreground">
          +{rows.reduce((n, r) => n + Number(r.kind === "add"), 0)} / −
          {rows.reduce((n, r) => n + Number(r.kind === "delete"), 0)}
        </span>
        <Button
          className="ml-auto"
          variant="ghost"
          size="xs"
          onClick={() => void copyText(patch)}
        >
          复制本次补丁
        </Button>
        {rows.length > PAGE_LINES && (
          <>
            <Button
              variant="ghost"
              size="xs"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              上一段
            </Button>
            <span>
              {current + 1} / {Math.ceil(rows.length / PAGE_LINES)}
            </span>
            <Button
              variant="ghost"
              size="xs"
              disabled={(current + 1) * PAGE_LINES >= rows.length}
              onClick={() => setPage(current + 1)}
            >
              下一段
            </Button>
          </>
        )}
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto font-mono text-xs leading-5"
        tabIndex={0}
      >
        <div className="min-w-max py-2">
          {rows
            .slice(current * PAGE_LINES, (current + 1) * PAGE_LINES)
            .map((row, i) => (
              <div
                key={current * PAGE_LINES + i}
                className={`flex whitespace-pre ${row.kind === "add" ? "bg-green-500/10" : row.kind === "delete" ? "bg-red-500/10" : row.kind === "header" ? "bg-muted text-muted-foreground" : ""}`}
              >
                <span
                  aria-label="原行号"
                  className="w-12 shrink-0 select-none px-2 text-right text-muted-foreground"
                >
                  {row.old}
                </span>
                <span
                  aria-label="新行号"
                  className="w-12 shrink-0 select-none border-r px-2 text-right text-muted-foreground"
                >
                  {row.next}
                </span>
                <span className="px-3">{row.text}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
