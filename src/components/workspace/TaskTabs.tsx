import type { KeyboardEvent } from "react";
import { systemFileActions } from "@/lib/systemFiles";
import { ContextActions } from "./ContextActions";
import { copyText } from "@/lib/clipboard";
import type { TabLocation } from "@/hooks/useTabHistory";
import {
  FileCode2,
  GitCompareArrows,
  Plus,
  X,
  Circle,
  PanelTop,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentIcon, StatusBadge } from "./shared";
import type { Task } from "@/lib/types";
import { dirtyFile, type OpenFile } from "@/lib/files";
import { cn } from "@/lib/utils";
export function TaskTabs({
  tasks,
  pageTab,
  selected,
  onSelect,
  onClose,
  onNew,
  files = [],
  selectedFile,
  onSelectFile,
  onCloseFile,
  onCloseMany,
}: {
  tasks: Task[];
  pageTab?: { title: string; onSelect: () => void };
  selected: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  files?: OpenFile[];
  selectedFile?: string | null;
  onSelectFile?: (id: string) => void;
  onCloseFile?: (id: string) => void;
  onCloseMany?: (tabs: TabLocation[]) => void;
}) {
  const tabs = [
    ...tasks.map((t) => ({
      id: t.id,
      title: t.title,
      tooltip: `${t.title} · ${t.deviceName || "本机"}`,
      active: !selectedFile && selected === t.id,
      task: t,
      file: undefined as OpenFile | undefined,
      select: () => onSelect(t.id),
      close: () => onClose(t.id),
    })),
    ...files.map((f) => ({
      id: f.id,
      title: f.skill ? `${f.skill.name} / SKILL.md` : f.path.split("/").at(-1)!,
      tooltip: `${f.project}/${f.path}${f.mode === "diff" ? " · 改动" : ""}`,
      active: selectedFile === f.id,
      task: undefined as Task | undefined,
      file: f,
      select: () => onSelectFile?.(f.id),
      close: () => onCloseFile?.(f.id),
    })),
  ];
  const controls = [
    ...(pageTab ? [{ id: "page-tab", select: pageTab.onSelect }] : []),
    ...tabs.map((t) => ({
      id: `${t.task ? "task" : "file"}-tab-${t.id}`,
      select: t.select,
    })),
  ];
  function moveFocus(e: KeyboardEvent, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const n =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? controls.length - 1
          : (index + (e.key === "ArrowRight" ? 1 : -1) + controls.length) %
            controls.length;
    controls[n].select();
    document.getElementById(controls[n].id)?.focus();
  }
  if (!tabs.length && !pageTab) return null;
  return (
    <div className="flex min-w-0 shrink-0 border-b bg-sidebar">
      <div
        role="tablist"
        aria-label="打开的任务与文件"
        className="flex min-w-0 flex-1 overflow-x-auto"
      >
        {pageTab && (
          <button
            role="tab"
            id="page-tab"
            aria-controls="page-panel"
            aria-label={`当前页面：${pageTab.title}`}
            aria-selected={!selected && !selectedFile}
            tabIndex={!selected && !selectedFile ? 0 : -1}
            className={cn(
              "sticky left-0 z-10 flex h-10 max-w-56 min-w-36 shrink-0 items-center gap-2 border-r px-3 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              !selected && !selectedFile
                ? "bg-background text-foreground"
                : "bg-sidebar text-muted-foreground hover:text-foreground",
            )}
            onClick={pageTab.onSelect}
            onKeyDown={(e) => moveFocus(e, 0)}
            title={`当前页面：${pageTab.title}`}
          >
            <PanelTop className="size-4 shrink-0" />
            <span className="truncate">{pageTab.title}</span>
          </button>
        )}
        {tabs.map((t, index) => (
          <ContextActions
            key={t.id}
            actions={[
              { label: "关闭标签", action: t.close },
              {
                label: "关闭其他标签",
                disabled: tabs.length < 2 || !onCloseMany,
                action: () =>
                  onCloseMany?.(
                    tabs
                      .filter((other) => other !== t)
                      .map((other) => ({
                        kind: other.task ? "task" : "file",
                        id: other.id,
                      })),
                  ),
              },
              {
                label: "关闭右侧标签",
                disabled: index === tabs.length - 1 || !onCloseMany,
                action: () =>
                  onCloseMany?.(
                    tabs.slice(index + 1).map((other) => ({
                      kind: other.task ? "task" : "file",
                      id: other.id,
                    })),
                  ),
              },
              ...(!t.task && t.file
                ? systemFileActions(
                    t.file.project,
                    t.file.path,
                    t.file.loading || !!t.file.error,
                  )
                : []),
              {
                label: t.task ? "复制任务标题" : "复制文件路径",
                separator: true,
                action: () =>
                  void copyText(
                    t.task ? t.title : `${t.file!.project}/${t.file!.path}`,
                  ),
              },
            ]}
          >
            <div
              className={cn(
                "flex shrink-0 items-center border-r pr-1",
                t.task ? "w-64" : "max-w-60",
                t.active ? "bg-background" : "text-muted-foreground",
              )}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  t.close();
                }
              }}
            >
              <button
                role="tab"
                id={`${t.task ? "task" : "file"}-tab-${t.id}`}
                aria-controls={`${t.task ? "task" : "file"}-panel-${t.id}`}
                aria-selected={t.active}
                tabIndex={
                  t.active ||
                  (!pageTab && !selected && !selectedFile && index === 0)
                    ? 0
                    : -1
                }
                className="flex h-10 min-w-0 flex-1 items-center gap-2 px-3 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                title={t.tooltip}
                onClick={t.select}
                onKeyDown={(e) => {
                  if (e.key === "Delete") {
                    e.preventDefault();
                    t.close();
                  }
                  moveFocus(e, index + (pageTab ? 1 : 0));
                }}
              >
                {t.task ? (
                  <AgentIcon kind={t.task.agentKind} className="size-4" />
                ) : t.file?.mode === "diff" ? (
                  <GitCompareArrows className="size-3.5 shrink-0" />
                ) : (
                  <FileCode2 className="size-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {t.title}
                  {t.file?.mode === "diff" ? " · 改动" : ""}
                </span>
                {t.task && (
                  <StatusBadge
                    status={t.task.status}
                    terminal={t.task.source === "terminal"}
                  />
                )}
                {t.file && dirtyFile(t.file) && (
                  <Circle
                    className="size-2 shrink-0 fill-current"
                    aria-label="未保存"
                  />
                )}
              </button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`关闭标签：${t.title}`}
                title={t.task ? "关闭标签（任务继续运行）" : "关闭文件"}
                onClick={t.close}
              >
                <X className="size-3" />
              </Button>
            </div>
          </ContextActions>
        ))}
      </div>
      <Button
        size="icon-sm"
        variant="ghost"
        className="m-1 shrink-0"
        aria-label="新建任务标签"
        onClick={onNew}
      >
        <Plus />
      </Button>
    </div>
  );
}
