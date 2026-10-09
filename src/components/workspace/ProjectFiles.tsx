import { FileContextMenu } from "./FileContextMenu";
import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  RefreshCw,
  Eye,
  ChevronsUp,
  GitCompareArrows,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { call, desktop } from "@/lib/api";
import {
  changeLabel,
  type Directory,
  type Changes,
  type Change,
} from "@/lib/files";
import { projectName } from "@/lib/types";

export function ProjectFiles({
  project,
  taskId,
  activePath,
  version,
  onOpen,
  onProjects,
}: {
  project: string;
  taskId?: string;
  activePath?: string;
  version: number;
  onOpen: (
    project: string,
    path: string,
    mode?: "edit" | "diff",
    originalPath?: string,
  ) => void;
  onProjects: () => void;
}) {
  const [tab, setTab] = useState("files");
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState(new Set<string>());
  const [dirs, setDirs] = useState<Record<string, Directory>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [changes, setChanges] = useState<Changes>();
  const [changeError, setChangeError] = useState("");
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{
    query: string;
    directory?: Directory;
    error?: string;
  }>();
  useEffect(() => {
    if (!desktop || !query.trim()) return;
    let alive = true;
    const timer = setTimeout(() => {
      void call<Directory>("search_project_files", { project, query, hidden })
        .then((directory) => {
          if (alive) setResults({ query, directory });
        })
        .catch((e) => {
          if (alive) setResults({ query, error: String(e) });
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [project, query, hidden]);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const paths = ["", ...expanded].sort().join("\0");
  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    const load = async () => {
      for (const path of paths.split("\0")) {
        try {
          const dir = await call<Directory>("project_files", {
            project,
            path,
            hidden,
          });
          if (alive) {
            setDirs((d) => ({ ...d, [path]: dir }));
            setErrors((d) => ({ ...d, [path]: "" }));
          }
        } catch (e) {
          if (alive) setErrors((d) => ({ ...d, [path]: String(e) }));
        }
      }
    };
    void load();
    const timer = setInterval(() => void load(), 8000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [project, paths, hidden, refresh, version]);
  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    const load = async () => {
      try {
        const d = await call<Changes>("project_changes", {
          project,
          taskId: taskId || null,
        });
        if (alive) {
          setChanges(d);
          setChangeError("");
        }
      } catch (e) {
        if (alive) setChangeError(String(e));
      }
    };
    void load();
    const timer = setInterval(() => void load(), 6000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [project, taskId, refresh, version]);
  const changeMap = new Map(changes?.files.map((f) => [f.path, f]));
  const toggle = useCallback(
    (path: string) =>
      setExpanded((s) => {
        const next = new Set(s);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      }),
    [],
  );
  function tree(path: string, depth = 0) {
    if (depth > 30)
      return <p className="px-3 text-xs text-muted-foreground">目录层级过深</p>;
    const dir = dirs[path];
    if (errors[path])
      return (
        <p className="break-words px-3 py-2 text-xs text-destructive">
          {errors[path]}
        </p>
      );
    if (!dir)
      return <p className="px-3 py-2 text-xs text-muted-foreground">读取中…</p>;
    return (
      <>
        {dir.entries.map((entry) => {
          const open = expanded.has(entry.path);
          const change = changeMap.get(entry.path);
          return (
            <div key={entry.path}>
              <FileContextMenu
                project={project}
                path={entry.path}
                onOpen={onOpen}
                directory={entry.directory}
                disabled={entry.symlink}
                expanded={open}
                onToggle={() => toggle(entry.path)}
                originalPath={change?.originalPath || undefined}
              >
                <Button
                  variant="navigation"
                  data-active={activePath === entry.path}
                  aria-current={
                    activePath === entry.path ? "location" : undefined
                  }
                  size="sm"
                  disabled={entry.symlink}
                  title={
                    entry.symlink ? `${entry.path}（符号链接）` : entry.path
                  }
                  aria-expanded={entry.directory ? open : undefined}
                  aria-label={
                    entry.directory
                      ? `${open ? "收起" : "展开"}文件夹 ${entry.name}`
                      : `打开文件 ${entry.path}`
                  }
                  onClick={() =>
                    entry.directory
                      ? toggle(entry.path)
                      : onOpen(project, entry.path)
                  }
                  className="h-7 w-full justify-start gap-1.5 rounded-sm pr-2 text-xs"
                  style={{ paddingLeft: 8 + depth * 12 }}
                >
                  {entry.directory ? (
                    <>
                      {open ? (
                        <ChevronDown className="size-3" />
                      ) : (
                        <ChevronRight className="size-3" />
                      )}
                      {open ? (
                        <FolderOpen className="size-3.5" />
                      ) : (
                        <Folder className="size-3.5" />
                      )}
                    </>
                  ) : (
                    <>
                      <span className="w-3 shrink-0" />
                      <FileCode2 className="size-3.5 text-muted-foreground" />
                    </>
                  )}
                  <span className="truncate">{entry.name}</span>
                  {change && (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {changeLabel(change.status)}
                    </span>
                  )}
                </Button>
              </FileContextMenu>
              {entry.directory && open && (
                <div role="group" aria-label={entry.path}>
                  {tree(entry.path, depth + 1)}
                </div>
              )}
            </div>
          );
        })}
        {!dir.entries.length && (
          <p className="px-4 py-2 text-xs text-muted-foreground">空文件夹</p>
        )}
        {dir.truncated && (
          <p className="px-3 text-xs text-muted-foreground">
            仅显示前 2,000 项
          </p>
        )}
      </>
    );
  }
  const openChange = (f: Change) =>
    onOpen(project, f.path, "diff", f.originalPath || undefined);
  return (
    <section
      className="flex min-h-0 flex-1 flex-col border-t"
      aria-label="项目文件"
    >
      <div className="flex items-center gap-1 px-2 py-2">
        <Button
          variant="ghost"
          size="xs"
          title="返回项目列表"
          aria-label="返回项目列表"
          onClick={onProjects}
        >
          <ArrowLeft className="size-3" />
          项目
        </Button>
        <span
          className="min-w-0 flex-1 truncate text-xs font-medium"
          title={project}
        >
          {projectName(project)}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="刷新项目文件"
          disabled={busy || !desktop}
          onClick={() => {
            setBusy(true);
            setRefresh((v) => v + 1);
            setTimeout(() => setBusy(false), 500);
          }}
        >
          <RefreshCw className={busy ? "animate-spin" : ""} />
        </Button>
      </div>
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <TabsList className="mx-2 mb-2 grid w-auto grid-cols-2">
          <TabsTrigger value="files" className="text-xs">
            文件
          </TabsTrigger>
          <TabsTrigger value="changes" className="text-xs">
            改动{changes?.files.length ? ` ${changes.files.length}` : ""}
          </TabsTrigger>
        </TabsList>
        {!desktop ? (
          <p className="p-4 text-xs leading-6 text-muted-foreground">
            文件浏览和编辑需要桌面版。请运行 npm run desktop。
          </p>
        ) : (
          <>
            <TabsContent
              value="files"
              className="mt-0 flex min-h-0 flex-1 flex-col"
            >
              <Input
                className="mx-2 mb-2 h-7 w-auto text-xs"
                aria-label="查找项目文件"
                placeholder="查找文件…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="mb-1 flex items-center px-2">
                <Button
                  variant="ghost"
                  size="xs"
                  aria-pressed={hidden}
                  onClick={() => setHidden((v) => !v)}
                  className="text-[11px] text-muted-foreground"
                >
                  <Eye className="size-3" />
                  {hidden ? "隐藏辅助文件" : "显示隐藏文件"}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ml-auto"
                  aria-label="折叠所有文件夹"
                  onClick={() => setExpanded(new Set())}
                >
                  <ChevronsUp />
                </Button>
              </div>
              <div
                className="min-h-0 flex-1 overflow-auto pb-4"
                aria-label="文件树"
              >
                {query.trim() ? (
                  results?.query !== query ? (
                    <p className="p-3 text-xs text-muted-foreground">查找中…</p>
                  ) : results.error ? (
                    <p role="alert" className="p-3 text-xs text-destructive">
                      {results.error}
                    </p>
                  ) : (
                    <>
                      {results.directory?.entries.map((entry) => (
                        <FileContextMenu
                          key={entry.path}
                          project={project}
                          path={entry.path}
                          onOpen={onOpen}
                          disabled={entry.symlink}
                        >
                          <Button
                            variant="navigation"
                            data-active={activePath === entry.path}
                            aria-current={
                              activePath === entry.path ? "location" : undefined
                            }
                            size="sm"
                            className="h-auto w-full justify-start py-2 text-left text-xs"
                            onClick={() => onOpen(project, entry.path)}
                            title={entry.path}
                          >
                            <FileCode2 className="size-3.5 shrink-0" />
                            <span className="min-w-0 truncate">
                              {entry.path}
                            </span>
                          </Button>
                        </FileContextMenu>
                      ))}
                      {!results.directory?.entries.length && (
                        <p className="p-3 text-xs text-muted-foreground">
                          没有匹配文件
                        </p>
                      )}
                      {results.directory?.truncated && (
                        <p className="px-3 text-xs text-muted-foreground">
                          结果已截断，请缩小搜索范围
                        </p>
                      )}
                    </>
                  )
                ) : (
                  tree("")
                )}
              </div>
            </TabsContent>
            <TabsContent
              value="changes"
              className="mt-0 flex min-h-0 flex-1 flex-col"
            >
              <p className="px-3 pb-2 text-[11px] leading-5 text-muted-foreground">
                工作区相对 HEAD 的改动，包含手动修改。
              </p>
              {changeError ? (
                <p role="alert" className="px-3 text-xs text-destructive">
                  {changeError}
                </p>
              ) : !changes ? (
                <p className="px-3 text-xs text-muted-foreground">读取改动…</p>
              ) : !changes.git ? (
                <p className="px-3 text-xs leading-5 text-muted-foreground">
                  此项目没有 Git 仓库，仍可浏览和编辑文件。
                </p>
              ) : (
                <>
                  {!!changes.files.length && (
                    <Input
                      className="mx-2 mb-2 h-7 w-auto text-xs"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="筛选改动文件…"
                      aria-label="筛选改动文件"
                    />
                  )}
                  <div className="min-h-0 flex-1 overflow-auto px-1">
                    {changes.files
                      .filter((f) =>
                        f.path.toLowerCase().includes(filter.toLowerCase()),
                      )
                      .map((f) => (
                        <FileContextMenu
                          key={f.path}
                          project={project}
                          path={f.path}
                          originalPath={f.originalPath || undefined}
                          onOpen={onOpen}
                          deleted={f.status === "D"}
                        >
                          <Button
                            variant="navigation"
                            data-active={activePath === f.path}
                            aria-current={
                              activePath === f.path ? "location" : undefined
                            }
                            className="h-auto w-full items-start gap-2 rounded-md px-2 py-2 text-left"
                            onClick={() => openChange(f)}
                            title={f.path}
                          >
                            <GitCompareArrows className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs">
                                {f.path.split("/").at(-1)}
                              </span>
                              <span className="block truncate text-[10px] text-muted-foreground">
                                {f.path}
                              </span>
                              {f.taskTouched && (
                                <span className="text-[10px] text-muted-foreground">
                                  本任务记录涉及
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {changeLabel(f.status)}
                            </span>
                          </Button>
                        </FileContextMenu>
                      ))}
                    {!changes.files.length && (
                      <p className="p-3 text-xs text-muted-foreground">
                        工作区没有未提交改动
                      </p>
                    )}
                    {changes.truncated && (
                      <p className="px-3 text-xs text-muted-foreground">
                        最多显示 500 个改动文件
                      </p>
                    )}
                  </div>
                </>
              )}
            </TabsContent>
          </>
        )}
      </Tabs>
    </section>
  );
}
