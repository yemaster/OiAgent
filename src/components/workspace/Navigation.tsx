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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { IconButton } from "./shared";
import { cn } from "@/lib/utils";
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
  automation: [{ page: "supervisor", icon: Workflow }],
  agents: [
    { page: "agents", icon: Bot },
    { page: "claude-api", icon: KeyRound },
  ],
  plugins: [{ page: "plugins", icon: Puzzle }],
  settings: [{ page: "settings", icon: Settings }],
} as const;
export function WorkspaceNavigation({
  page,
  project,
  snapshot,
  sidebar,
  onNavigate,
  onProject,
  onAddProject,
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
  project: string;
  snapshot: Snapshot;
  sidebar: boolean;
  onNavigate: (page: Page) => void;
  onProject: (project: string) => void;
  onAddProject: () => void;
  onSearch: () => void;
  onExpand: () => void;
}) {
  const [browsingProjects, setBrowsingProjects] = useState<string | null>(null);
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
        className="flex w-12 shrink-0 flex-col items-center gap-2 border-r bg-sidebar py-3"
      >
        {sections
          .filter((n) => n.id !== "settings")
          .map((n) => (
            <IconButton
              key={n.id}
              label={n.name}
              tooltipSide="right"
              aria-current={section === n.id ? "page" : undefined}
              onClick={() => {
                onNavigate(n.page);
                onExpand();
              }}
              className={cn(
                "relative size-9 rounded-md",
                section === n.id
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground",
              )}
            >
              <n.icon className="size-[18px]" />
              {n.id === "workspace" &&
                active.some((t) => t.status === "waiting") && (
                  <span className="absolute right-1 top-1 size-1.5 rounded-full bg-amber-600" />
                )}
            </IconButton>
          ))}
        <div className="flex-1" />
        <IconButton
          label="设置偏好"
          tooltipSide="right"
          onClick={() => {
            onNavigate("settings");
            onExpand();
          }}
          className={cn(
            "text-muted-foreground",
            page === "settings" && "bg-accent text-foreground",
          )}
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
          tooltipSide="right"
          onClick={() => onNavigate("guide")}
          className={cn(
            "text-muted-foreground",
            page === "guide" && "bg-accent text-foreground",
          )}
        >
          <CircleHelp />
        </IconButton>
      </nav>
      <AnimatePresence initial={false}>
        {sidebar && (
          <motion.aside
            aria-label="侧边导航"
            initial={{ width: 0, opacity: 0 }}
            animate={{
              width: project !== "all" && section === "workspace" ? 264 : 216,
              opacity: 1,
            }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="flex shrink-0 flex-col overflow-hidden border-r bg-sidebar"
          >
            <div className="flex h-12 shrink-0 items-center px-4 text-[13px] font-semibold">
              OiAgent
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {sections.find((s) => s.id === section)?.name}
              </span>
            </div>
            <div className="px-2 pb-4">
              <Button
                variant="outline"
                className="mb-3 h-8 w-full justify-start bg-card text-xs shadow-none"
                onClick={() => onNavigate("new")}
              >
                <Plus className="size-3.5" />
                新建任务
                <span className="ml-auto text-[11px] text-muted-foreground">
                  ⌘ N
                </span>
              </Button>
              <div className="space-y-0.5">
                {links[section].map((n) => (
                  <Button
                    key={n.page}
                    variant="ghost"
                    aria-current={
                      page === n.page && project === "all" ? "page" : undefined
                    }
                    className={cn(
                      "h-8 w-full justify-start text-[13px] font-normal",
                      page === n.page && project === "all"
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground",
                    )}
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
                              <Button
                                key={p}
                                variant="ghost"
                                title={p}
                                onClick={() => {
                                  setBrowsingProjects(null);
                                  onProject(p);
                                  onNavigate(
                                    page === "history" ? "history" : "tasks",
                                  );
                                }}
                                className={cn(
                                  "h-8 w-full justify-start gap-2 text-[13px] font-normal",
                                  project === p
                                    ? "bg-accent text-foreground"
                                    : "text-muted-foreground",
                                )}
                              >
                                <Folder className="size-3.5 shrink-0" />
                                <span className="truncate">
                                  {projectName(p)}
                                </span>
                              </Button>
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
              <div className="mx-4 border-t pt-4 text-xs leading-6 text-muted-foreground">
                {section === "automation"
                  ? "把一个目标拆成多个任务，由超级 Agent 依次派发并检查结果。"
                  : section === "agents"
                    ? "发现本机 Agent，或添加自己的启动程序。"
                    : section === "plugins"
                      ? "通过插件接入更多 Agent 与启动方式。"
                      : "设置工作区偏好，以及自动派发使用的 LLM API。"}
              </div>
            )}
            {(section !== "workspace" ||
              (!projectsOpen &&
                (project === "all" || browsingProjects === project))) && (
              <div className="flex-1" />
            )}
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
