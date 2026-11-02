import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ChevronRight,
  ArrowUp,
  File,
  Folder,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { call } from "@/lib/api";
import { projectName } from "@/lib/types";
import type { FileEntry } from "@/lib/files";

type DirectoryPage = { entries: FileEntry[]; next: string | null };
const parent = (path: string) => path.split("/").slice(0, -1).join("/");

function DirectoryPicker({
  project,
  directory,
  selected,
  onSelect,
}: {
  project: string;
  directory: string;
  selected: string;
  onSelect: (path: string) => void;
}) {
  const [path, setPath] = useState(directory);
  const [query, setQuery] = useState("");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([project, path, query, cursors.at(-1), retry]);
  const [result, setResult] = useState<{
    key: string;
    page?: DirectoryPage;
    error?: string;
  }>();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let alive = true;
    const [project, path, query, after] = JSON.parse(key) as [
      string,
      string,
      string,
      string | null,
    ];
    const timer = setTimeout(
      () => {
        void call<DirectoryPage>("browse_project_directory", {
          project,
          path,
          query,
          after,
        })
          .then((page) => {
            if (!page || !Array.isArray(page.entries))
              throw new Error("无法读取目录");
            if (alive) setResult({ key, page });
          })
          .catch((error) => {
            if (alive) setResult({ key, error: String(error) });
          });
      },
      query ? 180 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key]);
  const current = result?.key === key ? result : undefined;
  function enter(next: string) {
    setPath(next);
    setQuery("");
    setCursors([null]);
    input.current?.focus();
  }
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="上一级目录"
          disabled={!path}
          onClick={() => enter(parent(path))}
        >
          <ArrowUp />
        </Button>
        <span
          className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          title={path || project}
        >
          {path || projectName(project)}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="刷新目录"
          onClick={() => {
            setCursors([null]);
            setRetry((value) => value + 1);
          }}
        >
          <RefreshCw />
        </Button>
      </div>
      <Input
        ref={input}
        autoFocus
        aria-label="筛选当前目录"
        placeholder="查找文件或文件夹…"
        value={query}
        className="h-8 text-xs"
        onChange={(event) => {
          setQuery(event.target.value);
          setCursors([null]);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            event.currentTarget.parentElement
              ?.querySelector<HTMLButtonElement>(
                "[data-directory-entry]:not(:disabled)",
              )
              ?.focus();
          }
        }}
      />
      <div
        aria-label="目录内容"
        className="max-h-64 overflow-y-auto overscroll-contain"
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
            return;
          const entries = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "[data-directory-entry]:not(:disabled)",
            ),
          ];
          const index = entries.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          event.preventDefault();
          entries[
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? entries.length - 1
                : Math.max(
                    0,
                    Math.min(
                      entries.length - 1,
                      index + (event.key === "ArrowDown" ? 1 : -1),
                    ),
                  )
          ]?.focus();
        }}
      >
        {!current && (
          <p
            role="status"
            className="flex items-center gap-2 p-2 text-xs text-muted-foreground"
          >
            <LoaderCircle className="size-3 motion-safe:animate-spin" />
            读取中…
          </p>
        )}
        {current?.error && (
          <p role="alert" className="p-2 text-xs text-destructive">
            {current.error}
          </p>
        )}
        {current?.page?.entries.map((entry) => (
          <Button
            key={entry.path}
            data-directory-entry
            variant="ghost"
            className="h-8 w-full justify-start gap-2 px-2 text-xs font-normal aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
            disabled={entry.symlink}
            title={entry.symlink ? `${entry.name}（符号链接）` : entry.name}
            aria-current={entry.path === selected ? "page" : undefined}
            onClick={() =>
              entry.directory ? enter(entry.path) : onSelect(entry.path)
            }
          >
            {entry.directory ? (
              <Folder className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <File className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate text-left">
              {entry.name}
            </span>
            {entry.directory && (
              <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
            )}
          </Button>
        ))}
        {current?.page?.entries.length === 0 && (
          <p className="p-2 text-xs text-muted-foreground">
            {query ? "没有匹配的文件" : "空目录"}
          </p>
        )}
      </div>
      {(cursors.length > 1 || current?.page?.next) && (
        <div className="flex items-center justify-between border-t pt-2">
          <Button
            variant="ghost"
            size="xs"
            disabled={cursors.length === 1}
            onClick={() => setCursors((values) => values.slice(0, -1))}
          >
            上一页
          </Button>
          <span className="text-xs text-muted-foreground">
            第 {cursors.length} 页
          </span>
          <Button
            variant="ghost"
            size="xs"
            disabled={!current?.page?.next}
            onClick={() => {
              if (current?.page?.next)
                setCursors((values) => [...values, current.page!.next]);
            }}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}

/** VS Code-style sibling pickers. Directory pages are fetched only while open. */
export function FileBreadcrumbs({
  project,
  path,
  onOpen,
}: {
  project: string;
  path: string;
  onOpen: (path: string) => void;
}) {
  const [open, setOpen] = useState<number>();
  const nav = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (nav.current) nav.current.scrollLeft = nav.current.scrollWidth;
  }, [path, project]);
  const root = project.replaceAll("\\", "/").replace(/\/$/, "");
  const normalized = path.replaceAll("\\", "/");
  const relative = normalized.startsWith(root + "/")
    ? normalized.slice(root.length + 1)
    : normalized;
  const parts = relative.split("/").filter(Boolean);
  const segments = [
    { name: projectName(project), path: "", directory: "" },
    ...parts.map((name, i) => ({
      name,
      path: parts.slice(0, i + 1).join("/"),
      directory: parts.slice(0, i).join("/"),
    })),
  ];
  return (
    <nav
      ref={nav}
      aria-label="文件路径"
      className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap text-xs [scrollbar-width:none]"
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            "[data-breadcrumb]",
          ),
        ];
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        if (index < 0) return;
        event.preventDefault();
        buttons[index + (event.key === "ArrowRight" ? 1 : -1)]?.focus();
      }}
    >
      {segments.map((segment, index) => (
        <span className="flex shrink-0 items-center" key={index}>
          {index > 0 && (
            <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
          )}
          <Popover
            open={open === index}
            onOpenChange={(value) => setOpen(value ? index : undefined)}
          >
            <PopoverTrigger asChild>
              <button
                data-breadcrumb
                type="button"
                className="max-w-48 truncate rounded px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                aria-current={
                  index === segments.length - 1 ? "page" : undefined
                }
                title={segment.path || project}
              >
                {segment.name}
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="bottom"
              align="start"
              className="w-80 max-w-[calc(100vw-1rem)] p-2"
              aria-label={`浏览 ${segment.name}`}
              onOpenAutoFocus={(event) => event.preventDefault()}
            >
              {open === index && (
                <DirectoryPicker
                  project={project}
                  directory={segment.directory}
                  selected={segment.path}
                  onSelect={(selected) => {
                    setOpen(undefined);
                    onOpen(selected);
                  }}
                />
              )}
            </PopoverContent>
          </Popover>
        </span>
      ))}
    </nav>
  );
}
