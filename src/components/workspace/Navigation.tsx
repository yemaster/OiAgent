import { useOrganization, projectMarkKey } from "@/lib/organization";
import { WorkspaceItemActions, MarkIndicator } from "./WorkspaceItemActions";
import { useAppearance } from "@/lib/appearance";
import { surfaceTokens, defaultSurfaces } from "@/lib/surfaceColors";
import { useTheme } from "next-themes";
import { systemFileActions } from "@/lib/systemFiles";
import { ContextActions } from "./ContextActions";
import { BrandMark } from "./BrandMark";
import { copyText } from "@/lib/clipboard";
import { useSidebarWidth } from "@/hooks/useSidebarWidth";
import { ProjectFiles } from "./ProjectFiles";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Bot,
  ChartNoAxesCombined,
  CircleHelp,
  Folder,
  History,
  Inbox,
  KeyRound,
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { IconButton } from "./shared";
import {
  isActive,
  topLevelTasks,
  projectName,
  type Page,
  type Snapshot,
} from "@/lib/types";

import { pageNames, sectionFor, sections } from "@/lib/navigation";
const links = {
  workspace: [
    { page: "tasks", icon: Inbox },
    { page: "history", icon: History },
    { page: "stats", icon: ChartNoAxesCombined },
  ],
  todos: [
    { page: "todos", icon: ListTodo },
    { page: "todos-completed", icon: CircleCheck },
  ],
  automation: [{ page: "supervisor", icon: Workflow }],
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
    { page: "settings-llm", icon: KeyRound },
    { page: "settings-lan", icon: Network },
    { page: "settings-about", icon: Info },
  ],
} as const;
export function WorkspaceNavigation({
  page,
  todoReturnPage,
  project,
  snapshot,
  sidebar,
  onNavigate,
  onWorkspace,
  onProject,
  onAddProject,
  onNewProject,
  onSearch,
  onExpand,
  onOpenFile,
  taskId,
  activePath,
  fileVersion = 0,
}: {
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
  onNewProject?: (project: string) => void;
  onSearch: () => void;
  onExpand: () => void;
}) {
  const organization = useOrganization();
  const sidebarSize = useSidebarWidth();
  const [browsingProjects, setBrowsingProjects] = useState<string | null>(null);
  const { surfaces } = useAppearance();
  const { resolvedTheme } = useTheme();
  const surfaceMode = resolvedTheme === "dark" ? "dark" : "light";
  const [query, setQuery] = useState("");
  const [projectsOpen, setProjectsOpen] = useState(true);
  const section = sectionFor(page);
  const active = topLevelTasks(snapshot.tasks).filter(
    (t) => !t.archived && isActive(t),
  );
  return (
    <>
      <nav
        aria-label="工具栏"
        style={surfaceTokens(
          surfaces[surfaceMode].navigation ||
            (surfaces[surfaceMode].background
              ? defaultSurfaces[surfaceMode].navigation
              : undefined),
        )}
        className="text-sidebar-foreground flex w-14 shrink-0 flex-col items-center gap-2 border-r bg-sidebar py-3 [&_button]:size-10 [&_svg]:size-5"
      >
        {sections
          .filter((n) => n.id !== "settings")
          .map((n) => (
            <IconButton
              key={n.id}
              label={n.name}
              tooltipSide="right"
              variant="navigation"
              data-active={section === n.id}
              aria-current={section === n.id ? "page" : undefined}
              onClick={() => {
                if (n.id === "workspace" && onWorkspace) onWorkspace();
                else onNavigate(n.page);
                onExpand();
              }}
              className="size-10 rounded-md"
            >
              {n.id === "workspace" ? (
                <BrandMark navigation className="size-5" />
              ) : (
                <n.icon className="size-5" />
              )}
              {n.id === "workspace" &&
                active.some((t) => t.status === "waiting") && (
                  <span className="absolute right-1 top-1 size-1.5 rounded-full bg-amber-600" />
                )}
            </IconButton>
          ))}
        <div className="flex-1" />
        <IconButton
          label="设置偏好"
          variant="navigation"
          data-active={section === "settings"}
          aria-current={section === "settings" ? "page" : undefined}
          tooltipSide="right"
          onClick={() => {
            onNavigate("settings");
            onExpand();
          }}
        >
          <Settings />
        </IconButton>
        <IconButton
          label="全局搜索 · ⌘K"
          tooltipSide="right"
          onClick={onSearch}
          className="text-muted-foreground"
        >
          <Search />
        </IconButton>
        <IconButton
          label="使用指南"
          variant="navigation"
          data-active={page === "guide"}
          aria-current={page === "guide" ? "page" : undefined}
          tooltipSide="right"
          onClick={() => onNavigate("guide")}
        >
          <CircleHelp />
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
                  (surfaces[surfaceMode].background
                    ? defaultSurfaces[surfaceMode].sidebar
                    : undefined),
              ),
              width: sidebarSize.width,
              maxWidth: "calc(100vw - 400px)",
            }}
            className="relative flex shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground"
          >
            <div className="flex h-12 shrink-0 items-center gap-2 px-4 text-[13px] font-semibold">
              {sections.find((s) => s.id === section)?.name}
            </div>
            <div className="px-2 pb-4">
              {section === "workspace" && (
                <Button
                  variant="outline"
                  className="mb-3 h-8 w-full justify-start bg-card text-xs shadow-none"
                  onClick={() => onNavigate("new")}
                >
                  <Plus className="size-3.5" />
                  {project === "all" ? "新建任务" : "在此项目新建任务"}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    ⌘ N
                  </span>
                </Button>
              )}
              <div className="space-y-0.5">
                {links[section].map((n) => (
                  <Button
                    key={n.page}
                    variant="navigation"
                    data-active={
                      page === n.page ||
                      (page === "todos-edit" &&
                        n.page === (todoReturnPage || "todos")) ||
                      (page === "workflow-edit" && n.page === "supervisor") ||
                      (page === "claude-api-edit" && n.page === "claude-api")
                    }
                    aria-current={
                      page === n.page ||
                      (page === "todos-edit" &&
                        n.page === (todoReturnPage || "todos")) ||
                      (page === "workflow-edit" && n.page === "supervisor") ||
                      (page === "claude-api-edit" && n.page === "claude-api")
                        ? "page"
                        : undefined
                    }
                    className="h-8 w-full justify-start text-[13px]"
                    onClick={() => {
                      onProject("all");
                      onNavigate(n.page);
                    }}
                  >
                    <n.icon className="size-3.5" />
                    {pageNames[n.page]}
                    {n.page === "tasks" && active.length > 0 && (
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                        {active.length}
                      </span>
                    )}
                  </Button>
                ))}
              </div>
            </div>
            {section === "workspace" ? (
              project !== "all" &&
              browsingProjects !== project &&
              onOpenFile ? (
                <ProjectFiles
                  key={project}
                  project={project}
                  taskId={taskId}
                  activePath={activePath}
                  version={fileVersion}
                  onOpen={onOpenFile}
                  onProjects={() => setBrowsingProjects(project)}
                />
              ) : (
                <>
                  <div className="flex items-center px-3 pb-2 pt-3">
                    <Button
                      variant="ghost"
                      size="xs"
                      aria-expanded={projectsOpen}
                      onClick={() => setProjectsOpen(!projectsOpen)}
                      className="text-xs font-normal text-muted-foreground"
                    >
                      项目
                      <span aria-hidden="true">{projectsOpen ? "−" : "+"}</span>
                    </Button>
                    <IconButton
                      label="添加项目"
                      size="icon-xs"
                      className="ml-auto text-muted-foreground"
                      onClick={onAddProject}
                    >
                      <Plus className="size-3.5" />
                    </IconButton>
                  </div>
                  {projectsOpen && (
                    <>
                      {snapshot.projects.length > 8 && (
                        <div className="mb-2 px-3">
                          <Input
                            aria-label="筛选项目"
                            placeholder="查找项目…"
                            className="h-7 bg-card text-xs"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                        </div>
                      )}
                      <ScrollArea className="min-h-0 flex-1 px-2">
                        <div className="space-y-0.5 pb-5">
                          {snapshot.projects
                            .filter((p) =>
                              p.toLowerCase().includes(query.toLowerCase()),
                            )
                            .map((p) => (
                              <ContextActions
                                key={p}
                                actions={[
                                  {
                                    label: organization.marks[projectMarkKey(p)]
                                      ?.pinned
                                      ? "取消置顶"
                                      : "置顶项目",
                                    disabled:
                                      !organization.ready || organization.busy,
                                    action: () =>
                                      void organization.mark(
                                        projectMarkKey(p),
                                        {
                                          pinned:
                                            !organization.marks[
                                              projectMarkKey(p)
                                            ]?.pinned,
                                        },
                                      ),
                                  },
                                  {
                                    label: "在此项目新建任务",
                                    action: () => {
                                      setBrowsingProjects(null);
                                      onNewProject?.(p);
                                    },
                                  },
                                  {
                                    label: "查看项目任务",
                                    action: () => {
                                      setBrowsingProjects(null);
                                      onProject(p);
                                      onNavigate("tasks");
                                    },
                                  },
                                  {
                                    label: "查看项目历史",
                                    action: () => {
                                      setBrowsingProjects(null);
                                      onProject(p);
                                      onNavigate("history");
                                    },
                                  },
                                  ...systemFileActions(p),
                                  {
                                    label: "复制项目路径",
                                    separator: true,
                                    action: () => void copyText(p),
                                  },
                                ]}
                              >
                                <div className="group/item flex min-w-0 items-center">
                                  <Button
                                    variant="navigation"
                                    data-active={project === p}
                                    aria-current={
                                      project === p ? "location" : undefined
                                    }
                                    title={p}
                                    onClick={() => {
                                      setBrowsingProjects(null);
                                      onProject(p);
                                      onNavigate(
                                        page === "history"
                                          ? "history"
                                          : "tasks",
                                      );
                                    }}
                                    className="h-8 min-w-0 flex-1 justify-start gap-2 text-[13px]"
                                  >
                                    <Folder className="size-3.5 shrink-0" />
                                    <MarkIndicator
                                      mark={
                                        organization.marks[projectMarkKey(p)]
                                      }
                                    />
                                    <span className="truncate">
                                      {projectName(p)}
                                    </span>
                                    {snapshot.temporaryProjects?.some(
                                      (t) =>
                                        t.path === p && t.status === "active",
                                    ) && (
                                      <span className="ml-auto text-[10px] text-muted-foreground">
                                        临时
                                      </span>
                                    )}
                                  </Button>
                                  <WorkspaceItemActions
                                    itemKey={projectMarkKey(p)}
                                    name={projectName(p)}
                                  />
                                </div>
                              </ContextActions>
                            ))}
                          {!snapshot.projects.length && (
                            <p className="px-2 text-xs leading-5 text-muted-foreground">
                              添加项目文件夹，或同步已有对话。
                            </p>
                          )}
                        </div>
                      </ScrollArea>
                    </>
                  )}
                </>
              )
            ) : (
              <div className="flex-1" />
            )}
            {(section !== "workspace" ||
              (!projectsOpen &&
                (project === "all" || browsingProjects === project))) && (
              <div className="flex-1" />
            )}
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
