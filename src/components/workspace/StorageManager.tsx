import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Info, LoaderCircle, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { storageSize, type StorageItem } from "@/lib/storage";
import { Choice } from "./shared";

const pageSize = 50;
const selectionLimit = 100;
function protectedLabel(reason: string) {
  if (/已保留/.test(reason)) return "已保留";
  if (/文件标签|草稿/.test(reason)) return "已打开";
  if (/运行|待启动|待发送|正在使用|工作流|进程|终端/.test(reason))
    return "使用中";
  if (/未满/.test(reason)) return "未到期";
  return "受保护";
}

export function StorageManager({
  open,
  title,
  items,
  dataDir,
  onOpenChange,
  onDelete,
  onArchive,
  onReturnFocus,
}: {
  open: boolean;
  title: string;
  items: StorageItem[];
  dataDir: string;
  onOpenChange: (open: boolean) => void;
  onDelete: (items: StorageItem[]) => Promise<void>;
  onArchive?: () => void;
  onReturnFocus: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("size");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmation, setConfirmation] = useState<StorageItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (confirmation) cancel.current?.focus();
  }, [confirmation]);
  const sorted = useMemo(
    () =>
      [...items].sort((a, b) =>
        sort === "name"
          ? a.name.localeCompare(b.name, "zh-CN") || a.id.localeCompare(b.id)
          : b.bytes - a.bytes || a.id.localeCompare(b.id),
      ),
    [items, sort],
  );
  const filtered = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    return sorted.filter(
      (item) =>
        !text ||
        `${item.name}\n${item.paths.join("\n")}`
          .toLocaleLowerCase()
          .includes(text),
    );
  }, [sorted, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );
  const selectable = visible.filter((item) => !item.blockedReason);
  const canSelect = items.some((item) => !item.blockedReason);
  const chosen = items.filter(
    (item) => selected.has(item.id) && !item.blockedReason,
  );
  const chosenBytes = chosen.reduce((sum, item) => sum + item.bytes, 0);
  const checked = selectable.filter((item) => selected.has(item.id)).length;
  const allChecked = selectable.length > 0 && checked === selectable.length;
  function select(ids: string[], checked: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const id of ids) {
        if (!checked) next.delete(id);
        else if (next.size < selectionLimit) next.add(id);
      }
      return next;
    });
  }
  function back() {
    setConfirmation(null);
    setError("");
    // The button stays mounted while the confirmation content is shown.
    deleteButton.current?.focus();
  }
  async function remove() {
    if (inFlight.current || !confirmation?.length) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await onDelete(confirmation);
    } catch (error) {
      setError(String(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!inFlight.current) onOpenChange(next);
      }}
    >
      <DialogContent
        className="flex h-[min(620px,calc(100dvh-3rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          search.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
        onEscapeKeyDown={(event) => {
          if (inFlight.current || confirmation) {
            event.preventDefault();
            if (!inFlight.current) back();
          }
        }}
        onInteractOutside={(event) => {
          if (inFlight.current || confirmation) event.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0 px-5 pt-5 pb-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>
              {confirmation
                ? `永久删除所选 ${confirmation.length} 项？`
                : title}
            </DialogTitle>
            <span className="shrink-0 text-sm font-normal tabular-nums text-muted-foreground">
              {storageSize(
                (confirmation || items).reduce(
                  (sum, item) => sum + item.bytes,
                  0,
                ),
              )}
            </span>
          </div>
          <DialogDescription className={confirmation ? "text-xs" : "sr-only"}>
            {confirmation
              ? "删除后无法恢复，文件不会移入废纸篓。"
              : "选择要清理的项目。删除前需要再次确认。"}
          </DialogDescription>
        </DialogHeader>
        <div
          hidden={!!confirmation}
          className="min-h-0 flex-1 flex-col data-[visible=true]:flex"
          data-visible={!confirmation}
        >
          <div className="flex shrink-0 gap-2 px-5 pb-4 sm:px-6">
            <div className="relative min-w-0 flex-1">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground"
              />
              <Input
                ref={search}
                aria-label="搜索存储项目"
                placeholder="搜索名称或路径"
                className="pl-8"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
              />
            </div>
            <Choice
              label="排序"
              value={sort}
              onChange={(value) => {
                setSort(value);
                setPage(0);
              }}
              className="w-32 shrink-0"
              options={[
                { value: "size", label: "大小优先" },
                { value: "name", label: "名称排序" },
              ]}
            />
          </div>
          <div className="flex h-9 shrink-0 items-center gap-3 border-y bg-muted/40 px-5 text-xs text-muted-foreground sm:px-6">
            {canSelect && (
              <Checkbox
                id={`${id}-all`}
                className="after:inset-0"
                aria-label="选择本页可清理项目"
                disabled={
                  !selectable.length ||
                  (!allChecked && selected.size >= selectionLimit)
                }
                checked={allChecked ? true : checked ? "indeterminate" : false}
                onCheckedChange={(value) =>
                  select(
                    selectable.map((item) => item.id),
                    value === true,
                  )
                }
              />
            )}
            {canSelect ? (
              <label htmlFor={`${id}-all`} className="cursor-pointer">
                选择本页
              </label>
            ) : (
              <span>项目</span>
            )}
            <span className="ml-auto">{filtered.length} 项</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
            <ul className="divide-y" aria-label="存储项目">
              {visible.map((item) => (
                <li
                  key={item.id}
                  className="flex min-h-14 items-center gap-3 px-5 py-2.5 sm:px-6"
                >
                  {canSelect && (
                    <Checkbox
                      id={`${id}-${item.id}`}
                      className="after:inset-0"
                      aria-label={`选择 ${item.name}`}
                      checked={selected.has(item.id)}
                      disabled={
                        !!item.blockedReason ||
                        (!selected.has(item.id) &&
                          selected.size >= selectionLimit)
                      }
                      onCheckedChange={(value) =>
                        select([item.id], value === true)
                      }
                    />
                  )}
                  <label
                    htmlFor={canSelect ? `${id}-${item.id}` : undefined}
                    className="min-w-0 flex-1 cursor-default truncate text-sm"
                    title={item.name}
                  >
                    {item.name}
                  </label>
                  {item.blockedReason && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {protectedLabel(item.blockedReason)}
                    </span>
                  )}
                  <span className="w-16 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                    {item.partial && "≥ "}
                    {storageSize(item.bytes)}
                  </span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`${item.name}的详情`}
                      >
                        <Info />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="max-h-64 w-80 overflow-auto p-4 text-xs leading-5"
                    >
                      <p className="font-medium">{item.name}</p>
                      {item.blockedReason && <p>{item.blockedReason}</p>}
                      {!item.blockedReason && item.cleanupAfter && (
                        <p>
                          自动清理：
                          {new Date(item.cleanupAfter).toLocaleDateString(
                            "zh-CN",
                          )}
                        </p>
                      )}
                      {item.paths.map((path) => (
                        <code
                          key={path}
                          className="block break-all text-muted-foreground"
                        >
                          {path}
                        </code>
                      ))}
                      {!item.paths.length && (
                        <p className="text-muted-foreground">{dataDir}</p>
                      )}
                    </PopoverContent>
                  </Popover>
                </li>
              ))}
            </ul>
            {!visible.length && (
              <p className="px-6 py-16 text-center text-sm text-muted-foreground">
                {query ? "没有匹配的项目" : "暂无项目"}
              </p>
            )}
          </div>
          {pages > 1 && (
            <div className="flex shrink-0 items-center justify-end gap-3 border-t px-5 py-2 text-xs text-muted-foreground sm:px-6">
              <span>
                {currentPage + 1} / {pages}
              </span>
              <Button
                variant="ghost"
                size="xs"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                上一页
              </Button>
              <Button
                variant="ghost"
                size="xs"
                disabled={currentPage === pages - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                下一页
              </Button>
            </div>
          )}
        </div>
        {confirmation && (
          <div className="min-h-0 flex-1 overflow-auto px-5 pb-5 sm:px-6">
            <div className="mb-4 space-y-1 text-xs leading-5 text-muted-foreground">
              {Array.from(new Set(confirmation.map((item) => item.effect))).map(
                (effect) => (
                  <p key={effect}>{effect}</p>
                ),
              )}
            </div>
            <ul className="divide-y rounded-lg border px-4">
              {confirmation.map((item) => (
                <li key={item.id} className="space-y-2 py-3">
                  <div className="flex items-start justify-between gap-3 text-sm">
                    <span className="min-w-0 break-words font-medium">
                      {item.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {storageSize(item.bytes)}
                    </span>
                  </div>
                  {item.paths[0] && (
                    <code className="block break-all text-xs text-muted-foreground">
                      {item.paths[0]}
                    </code>
                  )}
                  {item.paths.length > 1 && (
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer">
                        另外 {item.paths.length - 1} 个位置
                      </summary>
                      <div className="mt-2 space-y-1">
                        {item.paths.slice(1).map((path) => (
                          <code key={path} className="block break-all">
                            {path}
                          </code>
                        ))}
                      </div>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <p
            role="alert"
            className="px-5 pb-3 text-sm text-destructive sm:px-6"
          >
            {error}
          </p>
        )}
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t bg-muted/30 px-5 py-3 sm:px-6">
          {!confirmation && (
            <>
              {canSelect && (
                <div
                  className="mr-auto flex items-center gap-2 text-xs text-muted-foreground"
                  aria-live="polite"
                >
                  <span>
                    {chosen.length
                      ? `已选 ${chosen.length} 项 · ${storageSize(chosenBytes)}`
                      : "未选择项目"}
                    {selected.size >= selectionLimit && " · 上限 100 项"}
                  </span>
                  {chosen.length > 0 && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setSelected(new Set())}
                    >
                      清空
                    </Button>
                  )}
                </div>
              )}
              {onArchive && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mr-auto"
                  onClick={onArchive}
                >
                  管理归档记录
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                完成
              </Button>
            </>
          )}
          {confirmation && (
            <Button
              ref={cancel}
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={back}
            >
              取消
            </Button>
          )}
          {canSelect && (
            <Button
              ref={deleteButton}
              variant="destructive"
              size="sm"
              disabled={busy || !chosen.length}
              aria-label={confirmation ? undefined : "删除所选项目"}
              onClick={() => {
                if (confirmation) void remove();
                else {
                  setError("");
                  setConfirmation(chosen);
                }
              }}
            >
              {busy ? (
                <LoaderCircle className="motion-safe:animate-spin" />
              ) : (
                <Trash2 />
              )}
              {busy ? "正在删除…" : confirmation ? "永久删除" : "删除所选"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
