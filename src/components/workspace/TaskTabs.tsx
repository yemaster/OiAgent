import { useShortcuts, matchesShortcut } from "@/lib/shortcuts";
import type { ExtensionTab } from "@/lib/extensions/types";
import { ExtensionIcon } from "@/components/extensions/ExtensionIcon";
import { useRef, useState, type KeyboardEvent } from "react";
import { useTabOrder } from "@/hooks/useTabOrder";
import { TabDrag, DraggableTab } from "./TabDrag";
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
  Columns2,
  Folder,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentIcon, StatusBadge } from "./shared";
import type { Task } from "@/lib/types";
import { dirtyFile, type OpenFile } from "@/lib/files";
import type { SplitSide } from "@/lib/editorGroups";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
const splitOptions = [
  ["right", "移到右侧分栏"],
  ["bottom", "移到下方分栏"],
  ["left", "移到左侧分栏"],
  ["top", "移到上方分栏"],
] as const;
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
  views = [],
  selectedView,
  onSelectView,
  onCloseView,
  group,
}: {
  group?: {
    order: string[];
    onMove: (key: string, target: string) => void;
    onSplit: (key: string, side: SplitSide) => void;
    onMerge?: () => void;
  };
  views?: ExtensionTab[];
  selectedView?: string | null;
  onSelectView?: (id: string) => void;
  onCloseView?: (id: string) => void;
  tasks: Task[];
  pageTab?: { title: string; onSelect: () => void; onClose?: () => void };
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
  const shortcuts = useShortcuts();
  const items = [
    ...(pageTab
      ? [
          {
            id: "page",
            key: "page",
            kind: "page" as const,
            view: undefined as ExtensionTab | undefined,
            page: true,
            title: pageTab.title,
            tooltip: `当前页面：${pageTab.title}`,
            active: !selected && !selectedFile && !selectedView,
            task: undefined as Task | undefined,
            file: undefined as OpenFile | undefined,
            select: pageTab.onSelect,
            close: () => pageTab.onClose?.(),
          },
        ]
      : []),
    ...tasks.map((t) => ({
      id: t.id,
      key: `task:${t.id}`,
      kind: "task" as const,
      view: undefined as ExtensionTab | undefined,
      page: false,
      title: t.title,
      tooltip: `${t.title} · ${t.deviceName || "本机"}`,
      active: !selectedView && !selectedFile && selected === t.id,
      task: t,
      file: undefined as OpenFile | undefined,
      select: () => onSelect(t.id),
      close: () => onClose(t.id),
    })),
    ...files.map((f) => ({
      id: f.id,
      key: `file:${f.id}`,
      kind: "file" as const,
      view: undefined as ExtensionTab | undefined,
      page: false,
      title: f.skill ? `${f.skill.name} / SKILL.md` : f.path.split("/").at(-1)!,
      tooltip: `${f.project}/${f.path}${f.mode === "diff" ? " · 改动" : ""}`,
      active: !selectedView && selectedFile === f.id,
      task: undefined as Task | undefined,
      file: f,
      select: () => onSelectFile?.(f.id),
      close: () => onCloseFile?.(f.id),
    })),
    ...views.map((view) => ({
      id: view.id,
      key: `extension:${view.id}`,
      kind: "extension" as const,
      page: false,
      view,
      title: view.title,
      tooltip: `${view.title} · ${view.pluginId}`,
      active: selectedView === view.id,
      task: undefined as Task | undefined,
      file: undefined as OpenFile | undefined,
      select: () => onSelectView?.(view.id),
      close: () => onCloseView?.(view.id),
    })),
  ];
  const scrollContainer = useRef<HTMLDivElement>(null);
  const localOrder = useTabOrder(items.map((t) => t.key));
  const order = group?.order || localOrder.order;
  const move = group?.onMove || localOrder.move;
  const byKey = new Map(items.map((t) => [t.key, t]));
  const tabs = order.map((key) => byKey.get(key)!);
  const closeable = tabs.filter((t) => !t.page);
  const [announcement, setAnnouncement] = useState("");
  const controls = tabs.map((t) => ({
    id: t.page ? "page-tab" : `${t.kind}-tab-${t.id}`,
    select: t.select,
  }));
  function moveFocus(e: KeyboardEvent, index: number) {
    const left = matchesShortcut(e.nativeEvent, shortcuts["move-tab-left"]);
    const right = matchesShortcut(e.nativeEvent, shortcuts["move-tab-right"]);
    if (left || right) {
      e.stopPropagation();
      e.preventDefault();
      const target = index + (left ? -1 : 1);
      if (target >= 0 && target < tabs.length) {
        move(tabs[index].key, tabs[target].key);
        setAnnouncement(`${tabs[index].title} 已移到第 ${target + 1} 个位置。`);
        requestAnimationFrame(() =>
          document
            .getElementById(controls[index].id)
            ?.scrollIntoView({ block: "nearest", inline: "nearest" }),
        );
      }
      return;
    }
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
    <TabDrag
      scrollContainer={scrollContainer}
      order={order}
      onMove={move}
      preview={(key) => {
        const t = byKey.get(key);
        return t ? (
          <>
            {t.page ? (
              pageTab?.onClose ? (
                <Folder className="size-4 shrink-0" />
              ) : (
                <PanelTop className="size-4 shrink-0" />
              )
            ) : t.task ? (
              <AgentIcon kind={t.task.agentKind} className="size-4" />
            ) : t.view ? (
              <ExtensionIcon name={t.view.icon} />
            ) : (
              <FileCode2 className="size-3.5 shrink-0" />
            )}
            <span className="truncate">{t.title}</span>
          </>
        ) : null;
      }}
    >
      <div className="flex min-w-0 shrink-0 border-b bg-sidebar">
        <div
          ref={scrollContainer}
          data-workspace-tabs
          role="tablist"
          aria-label="打开的任务与文件"
          className="flex min-w-0 flex-initial overflow-x-auto"
        >
          {tabs.map((t, index) => (
            <DraggableTab key={t.key} id={t.key}>
              {(handle) =>
                t.page ? (
                  <div
                    className={cn(
                      "flex shrink-0 items-center border-r",
                      t.active ? "bg-background" : "bg-sidebar",
                    )}
                    onAuxClick={(e) => {
                      if (e.button === 1 && pageTab?.onClose) {
                        e.preventDefault();
                        t.close();
                      }
                    }}
                  >
                    <button
                      {...handle}
                      role="tab"
                      id="page-tab"
                      aria-controls="page-panel"
                      aria-label={t.tooltip}
                      aria-selected={t.active}
                      tabIndex={t.active ? 0 : -1}
                      className={cn(
                        "flex h-10 max-w-56 min-w-36 touch-none select-none shrink-0 items-center gap-2 px-3 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        t.active
                          ? "bg-background text-foreground"
                          : "bg-sidebar text-muted-foreground hover:text-foreground",
                      )}
                      onClick={t.select}
                      onKeyDown={(e) => {
                        if (e.key === "Delete" && pageTab?.onClose) {
                          e.preventDefault();
                          t.close();
                        } else moveFocus(e, index);
                      }}
                      title={t.tooltip}
                    >
                      {pageTab?.onClose ? (
                        <Folder className="size-4 shrink-0" />
                      ) : (
                        <PanelTop className="size-4 shrink-0" />
                      )}
                      <span className="truncate">{t.title}</span>
                    </button>
                    {pageTab?.onClose && (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        className="mr-1"
                        aria-label={`退出项目：${t.title}`}
                        title="退出项目"
                        onClick={t.close}
                      >
                        <X className="size-3" />
                      </Button>
                    )}
                  </div>
                ) : (
                  <ContextActions
                    actions={[
                      ...(group
                        ? [
                            ...splitOptions.map(([side, label]) => ({
                              label,
                              disabled: tabs.length < 2,
                              action: () => group.onSplit(t.key, side),
                            })),
                            ...(group.onMerge
                              ? [
                                  {
                                    label: "合并所有分栏",
                                    action: group.onMerge,
                                  },
                                ]
                              : []),
                          ]
                        : []),
                      {
                        label: "关闭标签",
                        action: t.close,
                        separator: !!group,
                      },
                      {
                        label: "关闭其他标签",
                        disabled: closeable.length < 2 || !onCloseMany,
                        action: () =>
                          onCloseMany?.(
                            closeable
                              .filter((other) => other !== t)
                              .map((other) => ({
                                kind: other.kind as TabLocation["kind"],
                                id: other.id,
                              })),
                          ),
                      },
                      {
                        label: "关闭右侧标签",
                        disabled:
                          !tabs.slice(index + 1).some((other) => !other.page) ||
                          !onCloseMany,
                        action: () =>
                          onCloseMany?.(
                            tabs
                              .slice(index + 1)
                              .filter((other) => !other.page)
                              .map((other) => ({
                                kind: other.kind as TabLocation["kind"],
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
                        label: t.task
                          ? "复制任务标题"
                          : t.file
                            ? "复制文件路径"
                            : "复制标签标题",
                        separator: true,
                        action: () =>
                          void copyText(
                            t.file
                              ? `${t.file.project}/${t.file.path}`
                              : t.title,
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
                        {...handle}
                        role="tab"
                        id={`${t.kind}-tab-${t.id}`}
                        aria-controls={`${t.kind}-panel-${t.id}`}
                        aria-selected={t.active}
                        tabIndex={
                          t.active ||
                          (!pageTab &&
                            !selected &&
                            !selectedFile &&
                            index === 0)
                            ? 0
                            : -1
                        }
                        className="flex h-10 min-w-0 touch-none select-none flex-1 items-center gap-2 px-3 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        title={t.tooltip}
                        onClick={t.select}
                        onKeyDown={(e) => {
                          if (e.key === "Delete") {
                            e.preventDefault();
                            t.close();
                          }
                          moveFocus(e, index);
                        }}
                      >
                        {t.task ? (
                          <AgentIcon
                            kind={t.task.agentKind}
                            className="size-4"
                          />
                        ) : t.view ? (
                          <ExtensionIcon name={t.view.icon} />
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
                            terminal={
                              t.task.source === "terminal" ||
                              !!t.task.terminalId
                            }
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
                        title={
                          t.task
                            ? "关闭标签（任务继续运行）"
                            : t.file
                              ? "关闭文件"
                              : "关闭标签"
                        }
                        onClick={t.close}
                      >
                        <X className="size-3" />
                      </Button>
                    </div>
                  </ContextActions>
                )
              }
            </DraggableTab>
          ))}
        </div>
        <span role="status" aria-live="polite" className="sr-only">
          {announcement}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          className="mx-1 shrink-0 self-center"
          aria-label="新建任务标签"
          onClick={onNew}
        >
          <Plus />
        </Button>
        {group && (tabs.length > 1 || group.onMerge) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                className="ml-auto mr-1 shrink-0 self-center"
                aria-label="分栏布局"
                title="分栏布局"
              >
                <Columns2 />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {splitOptions.map(([side, label]) => (
                <DropdownMenuItem
                  key={side}
                  disabled={tabs.length < 2}
                  onSelect={() => {
                    const active = tabs.find((t) => t.active);
                    if (active) group.onSplit(active.key, side);
                  }}
                >
                  {label}
                </DropdownMenuItem>
              ))}
              {group.onMerge && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={group.onMerge}>
                    合并所有分栏
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </TabDrag>
  );
}
