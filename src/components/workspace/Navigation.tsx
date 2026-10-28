import { useShortcuts, shortcutLabel } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { useAppUpdate } from "@/lib/appUpdates";
import { projectGroup } from "@/lib/temporaryProjects";
import { SidebarSection } from "./SidebarSection";
import type { ProjectConfiguration } from "./ProjectMenu";
import type { Extension } from "@/lib/extensions/types";
import { extensionTabId } from "@/lib/extensions/types";
import { ExtensionIcon } from "@/components/extensions/ExtensionIcon";
import { useOrganization, projectMarkKey } from "@/lib/organization";
import { WorkspaceItemActions, MarkIndicator } from "./WorkspaceItemActions";
import { useAppearance } from "@/lib/appearance";
import { surfaceTokens, defaultSurfaces } from "@/lib/surfaceColors";
import { useTheme } from "next-themes";
import { systemFileActions } from "@/lib/systemFiles";
import { ContextActions } from "./ContextActions";
import { BrandMark } from "./BrandMark";
import { copyText } from "@/lib/clipboard";
import { usePageTransition } from "@/hooks/usePageTransition";
import { useSidebarWidth } from "@/hooks/useSidebarWidth";
import { ProjectFiles } from "./ProjectFiles";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronRight,
  Bot,
  ChartNoAxesCombined,
  Folder,
  History,
  Archive,
  Inbox,
  KeyRound,
  Keyboard,
  Plus,
  Puzzle,
  Search,
  Settings,
  Workflow,
  Palette,
  Info,
  Network,
  Blocks,
  FileText,
  ListTodo,
  CircleCheck,
  CalendarClock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { IconButton } from "./shared";
import {
  isActive,
  topLevelTasks,
  projectName,
  relativeTime,
  type Task,
  type Page,
  type Snapshot,
} from "@/lib/types";

import { pageNames, sectionFor, sections } from "@/lib/navigation";
const activityButtonClassName =
  "text-[var(--sidebar-icon)] hover:text-sidebar-foreground";
const links = {
  workspace: [
    { page: "tasks", icon: Inbox },
    { page: "history", icon: History },
    { page: "archived", icon: Archive },
    { page: "stats", icon: ChartNoAxesCombined },
  ],
  todos: [
    { page: "todos", icon: ListTodo },
    { page: "todos-completed", icon: CircleCheck },
  ],
  automation: [
    { page: "supervisor", icon: Workflow },
    { page: "schedules", icon: CalendarClock },
  ],
  agents: [
    { page: "agents", icon: Bot },
    { page: "claude-api", icon: KeyRound },
    { page: "integrations", icon: Blocks },
    { page: "instructions", icon: FileText },
  ],
  plugins: [{ page: "plugins", icon: Puzzle }],
  settings: [
    { page: "settings", icon: Settings },
    { page: "settings-appearance", icon: Palette },
    { page: "settings-shortcuts", icon: Keyboard },
    { page: "settings-llm", icon: KeyRound },
    { page: "settings-lan", icon: Network },
    { page: "settings-about", icon: Info },
  ],
} as const;
export function WorkspaceNavigation({
  page,
  extensions = [],
  activeExtensionId,
  onOpenExtension,
  todoReturnPage,
  project,
  snapshot,
  sidebar,
  onNavigate,
  onWorkspace,
  onProject,
  onAddProject,
  onOpenTask,
  onNewProject,
  onConfigureProject,
  onSearch,
  onExpand,
  onOpenFile,
  taskId,
  activePath,
  fileVersion = 0,
}: {
  onConfigureProject?: (project: string, page: ProjectConfiguration) => void;
  extensions?: Extension[];
  activeExtensionId?: string;
  onOpenExtension?: (pluginId: string, viewId: string) => void;
  onOpenFile?: (
    project: string,
    path: string,
    mode?: "edit" | "diff",
    originalPath?: string,
  ) => void;
  taskId?: string;
  activePath?: string;
  fileVersion?: number;
  page: Page;
  todoReturnPage?: Page;
  project: string;
  snapshot: Snapshot;
  sidebar: boolean;
  onNavigate: (page: Page) => void;
  onWorkspace?: () => void;
  onProject: (project: string) => void;
  onAddProject: () => void;
  onOpenTask?: (task: Task) => void;
  onNewProject?: (project: string) => void;
  onSearch: () => void;
  onExpand: () => void;
}) {
  const shortcuts = useShortcuts();
  const organization = useOrganization();
  const update = useAppUpdate();
  const sidebarSize = useSidebarWidth();
  const { surfaces } = useAppearance();
  const { resolvedTheme } = useTheme();
  const surfaceMode = resolvedTheme === "dark" ? "dark" : "light";
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const recentTasks = useMemo(() => {
    const groups = new Map<string, Task[]>();
    for (const task of topLevelTasks(snapshot.tasks)
      .filter((task) => !task.archived)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
      const key = projectGroup(task.project, snapshot.temporaryProjects);
      const rows = groups.get(key) || [];
      rows.push(task);
      groups.set(key, rows);
    }
    return groups;
  }, [snapshot.tasks, snapshot.temporaryProjects]);
  const section = sectionFor(page);
  const sidebarTransition = usePageTransition(
    JSON.stringify([section, project, projectsOpen]),
  );
  const active = topLevelTasks(snapshot.tasks).filter(
    (t) => !t.archived && isActive(t),
  );
  const waitingCount = active.filter((t) => t.status === "waiting").length;
  return (
    <>
      <nav
        aria-label="工具栏"
        style={surfaceTokens(
          surfaces[surfaceMode].navigation ||
            defaultSurfaces[surfaceMode].navigation,
        )}
        className="text-sidebar-foreground flex w-14 shrink-0 flex-col items-center gap-1 bg-sidebar py-2 [&_button]:size-10 [&_svg]:size-6"
      >
        {sections
          .filter((n) => n.id !== "settings")
          .map((n) => (
            <IconButton
              key={n.id}
              label={n.name}
              tooltipSide="right"
              variant="navigation"
              data-active={section === n.id && !activeExtensionId}
              aria-current={
                section === n.id && !activeExtensionId ? "page" : undefined
              }
              onClick={() => {
                if (n.id === "workspace" && onWorkspace) onWorkspace();
                else onNavigate(n.page);
                onExpand();
              }}
              className={`size-10 rounded-md ${activityButtonClassName}`}
            >
              {n.id === "workspace" ? (
                <BrandMark navigation className="size-6" />
              ) : (
                <n.icon className="size-6" />
              )}
              {n.id === "workspace" && waitingCount > 0 && (
                <span className="absolute right-1 top-1 size-1.5 rounded-full bg-amber-600" />
              )}
            </IconButton>
          ))}
        <div className="flex min-h-0 flex-col gap-1 overflow-y-auto">
          {extensions
            .filter((p) => p.enabled)
            .flatMap((p) =>
              p.manifest.contributes.views
                .filter((v) => v.activityBar)
                .map((v) => (
                  <IconButton
                    key={`${p.manifest.id}/${v.id}`}
                    label={`${v.title} · ${p.manifest.name}`}
                    tooltipSide="right"
                    variant="navigation"
                    className={activityButtonClassName}
                    data-active={activeExtensionId?.startsWith(
                      `${p.manifest.id}/`,
                    )}
                    onClick={() => onOpenExtension?.(p.manifest.id, v.id)}
                  >
                    <ExtensionIcon name={v.icon} className="size-6" />
                  </IconButton>
                )),
            )}
        </div>
        <div className="flex-1" />
        <IconButton
          label={`全局搜索 · ${shortcutLabel(shortcuts.search)}`}
          tooltipSide="right"
          onClick={onSearch}
          className={activityButtonClassName}
        >
          <Search className="size-6" />
        </IconButton>
        <IconButton
          label="设置偏好"
          className={cn("relative", activityButtonClassName)}
          variant="navigation"
          data-active={section === "settings"}
          aria-current={section === "settings" ? "page" : undefined}
          tooltipSide="right"
          onClick={() => {
            onNavigate("settings");
            onExpand();
          }}
        >
          <Settings className="size-6" />
          {update.result?.updateAvailable && (
            <span
              role="img"
              aria-label="有新版本更新"
              className="pointer-events-none absolute right-1.5 top-1.5 size-2 rounded-full bg-amber-500 ring-2 ring-sidebar"
            />
          )}
        </IconButton>
      </nav>
      <AnimatePresence initial={false}>
        {sidebar && (
          <motion.aside
            aria-label="侧边导航"
            id="workspace-sidebar"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            style={{
              ...surfaceTokens(
                surfaces[surfaceMode].sidebar ||
                  defaultSurfaces[surfaceMode].sidebar,
              ),
              width: sidebarSize.width,
              maxWidth: "calc(100vw - 400px)",
            }}
            className="relative flex shrink-0 flex-col bg-sidebar text-sidebar-foreground"
          >
            <div className="flex h-12 shrink-0 items-center gap-2 px-4 text-[13px] font-semibold">
              {sections.find((s) => s.id === section)?.name}
            </div>
            <div className="border-b border-sidebar-border/30 px-3 pb-4">
              {section === "plugins" &&
                extensions
                  .filter((p) => p.enabled)
                  .map((p) => (
                    <div key={p.manifest.id} className="mb-4 space-y-1">
                      <p className="truncate px-2 py-1 text-xs text-muted-foreground">
                        {p.manifest.name}
                      </p>
                      {p.manifest.contributes.views.map((v) => (
                        <Button
                          key={v.id}
                          variant="navigation"
                          className="h-9 w-full justify-start gap-2.5 px-3 text-sm"
                          data-active={
                            activeExtensionId ===
                            extensionTabId(p.manifest.id, v.id)
                          }
                          onClick={() => onOpenExtension?.(p.manifest.id, v.id)}
                        >
                          <ExtensionIcon name={v.icon} />
                          <span className="truncate">{v.title}</span>
                        </Button>
                      ))}
                    </div>
                  ))}
              {section === "workspace" && (
                <Button
                  variant="navigation"
                  data-active={page === "new" && !activeExtensionId}
                  aria-current={
                    page === "new" && !activeExtensionId ? "page" : undefined
                  }
                  className="mb-3 h-9 w-full justify-start gap-2.5 border border-sidebar-border bg-background/70 px-3 text-sm"
                  onClick={() => onNavigate("new")}
                >
                  <Plus className="size-3.5" />
                  {project === "all" ? "新建任务" : "在此项目新建任务"}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    ⌘ N
                  </span>
                </Button>
              )}
              <div className="space-y-1">
                {links[section].map((n) => (
                  <Button
                    key={n.page}
                    variant="navigation"
                    data-active={
                      (page === n.page &&
                        !activeExtensionId &&
                        (section !== "workspace" ||
                          project === "all" ||
                          !!taskId)) ||
                      (page === "todos-edit" &&
                        n.page === (todoReturnPage || "todos")) ||
                      (page === "workflow-edit" && n.page === "supervisor") ||
                      (page === "schedule-edit" && n.page === "schedules") ||
                      (page === "claude-api-edit" && n.page === "claude-api")
                    }
                    aria-current={
                      (page === n.page &&
                        !activeExtensionId &&
                        (section !== "workspace" ||
                          project === "all" ||
                          !!taskId)) ||
                      (page === "todos-edit" &&
                        n.page === (todoReturnPage || "todos")) ||
                      (page === "workflow-edit" && n.page === "supervisor") ||
                      (page === "schedule-edit" && n.page === "schedules") ||
                      (page === "claude-api-edit" && n.page === "claude-api")
                        ? "page"
                        : undefined
                    }
                    className="h-9 w-full justify-start gap-2.5 px-3 text-sm"
                    onClick={() => {
                      onProject("all");
                      onNavigate(n.page);
                    }}
                  >
                    <n.icon className="size-4" />
                    {pageNames[n.page]}
                    {n.page === "settings-about" &&
                      update.result?.updateAvailable && (
                        <span
                          className="ml-auto size-2 rounded-full bg-amber-500"
                          aria-label="有新版本更新"
                          role="img"
                        />
                      )}
                    {n.page === "tasks" &&
                      active.length > 0 &&
                      (waitingCount > 0 ? (
                        <Badge
                          className="ml-auto h-5 min-w-5 rounded-full bg-amber-400 px-1 text-[11px] font-semibold tabular-nums text-amber-950 dark:bg-amber-400 dark:text-amber-950"
                          aria-label={`${waitingCount} 个任务等待处理`}
                          title={`${waitingCount} 个任务等待处理`}
                        >
                          {waitingCount > 99 ? "99+" : waitingCount}
                        </Badge>
                      ) : (
                        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                          {active.length}
                        </span>
                      ))}
                  </Button>
                ))}
              </div>
            </div>
            <div
              ref={sidebarTransition}
              className="flex min-h-0 flex-1 flex-col"
            >
              {section === "workspace" ? (
                <>
                  {project !== "all" &&
                    onOpenFile &&
                    !snapshot.temporaryProjects?.some(
                      (p) =>
                        p.status !== "kept" &&
                        (p.path === project ||
                          project.startsWith(p.path + "/")),
                    ) && (
                      <ProjectFiles
                        key={project}
                        project={project}
                        taskId={taskId}
                        activePath={activePath}
                        version={fileVersion}
                        onOpen={onOpenFile}
                      />
                    )}
                  <SidebarSection
                    title="任务"
                    label="项目列表"
                    open={projectsOpen}
                    onOpenChange={setProjectsOpen}
                    actions={
                      <IconButton
                        label="添加项目"
                        size="icon-xs"
                        className="text-muted-foreground"
                        onClick={onAddProject}
                      >
                        <Plus className="size-3.5" />
                      </IconButton>
                    }
                  >
                    {/* This vertical list must fit the viewport. Radix's
                          intrinsic-width table otherwise lets long names push
                          the action buttons outside the clipped sidebar. */}
                    <ScrollArea className="min-h-0 min-w-0 flex-1 px-2 [&>[data-slot=scroll-area-viewport]>div]:block!">
                      <div className="w-full min-w-0 space-y-0.5 pb-5">
                        {snapshot.projects.map((p) => (
                          <div key={p}>
                            <ContextActions
                              actions={[
                                {
                                  label: organization.marks[projectMarkKey(p)]
                                    ?.pinned
                                    ? "取消置顶"
                                    : "置顶项目",
                                  disabled:
                                    !organization.ready || organization.busy,
                                  action: () =>
                                    void organization.mark(projectMarkKey(p), {
                                      pinned:
                                        !organization.marks[projectMarkKey(p)]
                                          ?.pinned,
                                    }),
                                },
                                {
                                  label: "在此项目新建任务",
                                  action: () => {
                                    onNewProject?.(p);
                                  },
                                },
                                {
                                  label: "查看项目任务",
                                  action: () => {
                                    onProject(p);
                                    onNavigate("tasks");
                                  },
                                },
                                {
                                  label: "查看项目历史",
                                  action: () => {
                                    onProject(p);
                                    onNavigate("history");
                                  },
                                },
                                ...(onConfigureProject
                                  ? [
                                      {
                                        label: "项目指令",
                                        separator: true,
                                        action: () =>
                                          onConfigureProject(p, "instructions"),
                                      },
                                      {
                                        label: "MCP 与 Skills",
                                        action: () =>
                                          onConfigureProject(p, "integrations"),
                                      },
                                    ]
                                  : []),
                                ...systemFileActions(p),
                                {
                                  label: "复制项目路径",
                                  separator: true,
                                  action: () => void copyText(p),
                                },
                              ]}
                            >
                              <div
                                data-pinned={
                                  !!organization.marks[projectMarkKey(p)]
                                    ?.pinned
                                }
                                data-active={
                                  projectGroup(
                                    project,
                                    snapshot.temporaryProjects,
                                  ) === p
                                }
                                className={cn(
                                  "group/item grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center rounded-lg transition-colors",
                                  projectGroup(
                                    project,
                                    snapshot.temporaryProjects,
                                  ) === p && !taskId
                                    ? "bg-sidebar-accent"
                                    : "hover:bg-sidebar-accent/60 focus-within:bg-sidebar-accent/60",
                                  projectGroup(
                                    project,
                                    snapshot.temporaryProjects,
                                  ) !== p &&
                                    organization.marks[projectMarkKey(p)]
                                      ?.pinned &&
                                    "bg-sidebar-accent/35",
                                )}
                              >
                                <button
                                  aria-label={`${collapsed.has(p) ? "展开" : "收起"}项目任务：${projectName(p)}`}
                                  aria-expanded={!collapsed.has(p)}
                                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                                  onClick={() =>
                                    setCollapsed((old) => {
                                      const next = new Set(old);
                                      if (next.has(p)) next.delete(p);
                                      else next.add(p);
                                      return next;
                                    })
                                  }
                                >
                                  <ChevronRight
                                    className={cn(
                                      "size-3 transition-transform",
                                      !collapsed.has(p) && "rotate-90",
                                    )}
                                  />
                                </button>
                                <Button
                                  variant="navigation"
                                  data-active={
                                    projectGroup(
                                      project,
                                      snapshot.temporaryProjects,
                                    ) === p
                                  }
                                  data-pinned={
                                    !!organization.marks[projectMarkKey(p)]
                                      ?.pinned
                                  }
                                  aria-current={
                                    projectGroup(
                                      project,
                                      snapshot.temporaryProjects,
                                    ) === p
                                      ? "location"
                                      : undefined
                                  }
                                  title={p}
                                  onClick={() => {
                                    onProject(p);
                                    onNavigate(
                                      page === "history" || page === "archived"
                                        ? page
                                        : "tasks",
                                    );
                                  }}
                                  className="h-8 min-w-0 overflow-hidden justify-start gap-2 text-[13px] hover:bg-transparent data-[active=true]:bg-transparent data-[active=true]:hover:bg-transparent data-[pinned=true]:data-[active=false]:font-medium data-[pinned=true]:data-[active=false]:text-sidebar-foreground"
                                >
                                  {!organization.marks[projectMarkKey(p)]
                                    ?.pinned && (
                                    <Folder className="size-3.5 shrink-0" />
                                  )}
                                  <MarkIndicator
                                    pinClassName="size-3.5 text-current"
                                    mark={organization.marks[projectMarkKey(p)]}
                                  />
                                  <span className="truncate">
                                    {projectName(p)}
                                  </span>
                                  {snapshot.temporaryProjects?.some(
                                    (t) =>
                                      t.path === p && t.status === "active",
                                  ) && (
                                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                                      临时
                                    </span>
                                  )}
                                </Button>
                                <div className="max-w-16 transition-[max-width] duration-150 motion-reduce:transition-none [@media(hover:hover)]:max-w-0 [@media(hover:hover)]:overflow-hidden [@media(hover:hover)]:group-hover/item:max-w-16 [@media(hover:hover)]:group-focus-within/item:max-w-16 [@media(hover:hover)]:group-focus-within/item:overflow-visible [@media(hover:hover)]:has-[[data-state=open]]:max-w-16">
                                  <WorkspaceItemActions
                                    itemKey={projectMarkKey(p)}
                                    name={projectName(p)}
                                  />
                                </div>
                              </div>
                            </ContextActions>
                            {!collapsed.has(p) && (
                              <div className="mb-3 mt-1 space-y-0.5 animate-in fade-in duration-150 motion-reduce:animate-none">
                                {(recentTasks.get(p) || [])
                                  .slice(0, 5)
                                  .map((task) => (
                                    <Button
                                      key={task.id}
                                      variant="ghost"
                                      aria-label={`打开任务：${task.title}`}
                                      aria-current={
                                        taskId === task.id ? "page" : undefined
                                      }
                                      onClick={() => onOpenTask?.(task)}
                                      className={cn(
                                        "h-8 w-full justify-start gap-2 rounded-lg px-3 text-xs font-normal",
                                        taskId === task.id &&
                                          "bg-sidebar-accent hover:bg-sidebar-accent",
                                      )}
                                    >
                                      <span
                                        aria-label={task.status}
                                        className={cn(
                                          "ml-3 size-1.5 shrink-0 rounded-full",
                                          task.status === "waiting"
                                            ? "bg-amber-500"
                                            : isActive(task)
                                              ? "bg-sky-500"
                                              : task.status === "failed"
                                                ? "bg-destructive"
                                                : "bg-transparent",
                                        )}
                                      />
                                      <span className="min-w-0 flex-1 truncate text-left">
                                        {task.title}
                                      </span>
                                      <span className="shrink-0 text-[10px] text-muted-foreground">
                                        {relativeTime(task.updatedAt)
                                          .replace(" 分钟前", "m")
                                          .replace(" 小时前", "h")
                                          .replace(" 天前", "d")}
                                      </span>
                                    </Button>
                                  ))}
                              </div>
                            )}
                          </div>
                        ))}
                        {[...recentTasks.values()].some(
                          (tasks) => tasks.length > 5,
                        ) && (
                          <Button
                            variant="link"
                            size="sm"
                            className="h-7 w-full text-xs text-muted-foreground"
                            onClick={() => {
                              onProject("all");
                              onNavigate("history");
                            }}
                          >
                            查看历史任务
                          </Button>
                        )}
                        {!snapshot.projects.length && (
                          <p className="px-2 text-xs leading-5 text-muted-foreground">
                            暂无项目
                          </p>
                        )}
                      </div>
                    </ScrollArea>
                  </SidebarSection>
                </>
              ) : (
                <div className="flex-1" />
              )}
            </div>
            <div
              {...sidebarSize.separator}
              aria-controls="workspace-sidebar"
              className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-ring/30 focus-visible:bg-ring/40 focus-visible:outline-none"
            />
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
