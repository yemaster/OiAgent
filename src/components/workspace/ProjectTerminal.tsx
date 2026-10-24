import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import {
  LoaderCircle,
  Plus,
  Columns2,
  PanelsTopLeft,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { call, desktop } from "@/lib/api";
import { type Task } from "@/lib/types";
import {
  emptyProjectTerminals,
  emptyTerminalWorkspace,
  projectTerminalsReducer,
} from "@/lib/projectTerminals";
import { IconButton } from "./shared";
import { PaneBoundary } from "./PaneBoundary";
import { toast } from "sonner";

const TerminalView = lazy(() =>
  import("./TerminalView").then((m) => ({ default: m.TerminalView })),
);
type LaunchOptions = { fresh?: boolean; splitGroup?: string; file?: string };
const running = (task?: Task) =>
  task?.status === "running" || task?.status === "stopping";
const loading = (
  <span
    role="status"
    aria-label="终端启动中"
    className="pointer-events-none p-3 text-muted-foreground"
  >
    <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
  </span>
);

/** A tab owns its split panes; changing the focused process never changes group membership. */
export function ProjectTerminal({
  project,
  open,
  onClose,
  children,
}: {
  project: string | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(
    projectTerminalsReducer,
    emptyProjectTerminals,
  );
  const [pending, setPending] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const requests = useRef(new Map<string, Promise<void>>());
  const retryOptions = useRef<Record<string, LaunchOptions>>({});
  const retired = useRef(new Set<string>());
  const ready = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  const panel = useRef<HTMLElement>(null);
  const [layouts, setLayouts] = useState<
    Record<string, Record<string, number>>
  >({});
  const visible = open && !!project;
  const workspace =
    (project && state.projects[project]) || emptyTerminalWorkspace;
  const group = workspace.groups.find((item) => item.id === workspace.selected);
  const task = group ? state.sessions[group.focused] : undefined;
  const busy = !!project && pending.includes(project);
  const update = useCallback(
    (task: Task) => dispatch({ type: "update", task }),
    [],
  );

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let off: (() => void) | undefined;
    if (desktop) {
      ready.current = listen<Task>("project-terminal-changed", ({ payload }) =>
        update(payload),
      ).then((unlisten) => {
        if (disposed) unlisten();
        else off = unlisten;
      });
      // The launch path reports subscription errors rather than starting an untracked process.
      void ready.current.catch(() => {});
    }
    return () => {
      mounted.current = false;
      disposed = true;
      off?.();
    };
  }, [update]);
  useEffect(() => {
    for (const id of Object.keys(state.retired)) {
      if (retired.current.has(id)) continue;
      retired.current.add(id);
      void import("@/lib/terminalSession").then((module) =>
        module.discardTerminalSession(id),
      );
    }
  }, [state.retired]);

  const start = useCallback(
    async (path: string, options: LaunchOptions = {}) => {
      // A run click may arrive while the panel is creating its initial shell.
      // Queue file runs rather than silently dropping them behind that launch.
      for (;;) {
        const pending = requests.current.get(path);
        if (!pending) break;
        if (!options.file) return;
        await pending;
        if (!mounted.current) return;
      }
      let release!: () => void;
      requests.current.set(
        path,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      retryOptions.current[path] = options;
      dispatch({ type: "begin", project: path });
      setPending((values) => [...values, path]);
      setErrors((values) => ({ ...values, [path]: "" }));
      try {
        // StrictMode can replace the event subscription while the first launch is waiting.
        for (;;) {
          const subscription = ready.current;
          try {
            await subscription;
          } catch (error) {
            if (subscription === ready.current) throw error;
          }
          if (subscription === ready.current || !mounted.current) break;
        }
        if (!mounted.current) return;
        const task = await call<Task>("project_terminal_start", {
          project: path,
          newSession: !!options.fresh,
          ...(options.file ? { file: options.file } : {}),
        });
        if (mounted.current)
          dispatch({
            type: "started",
            task,
            project: path,
            splitGroup: options.splitGroup,
          });
      } catch (error) {
        if (mounted.current)
          setErrors((values) => ({ ...values, [path]: String(error) }));
      } finally {
        requests.current.delete(path);
        release();
        if (mounted.current)
          setPending((values) => values.filter((value) => value !== path));
      }
    },
    [],
  );
  const previousVisible = useRef<string | null>(null);
  useEffect(() => {
    const opening = visible && previousVisible.current !== project;
    previousVisible.current = visible ? project : null;
    if (opening && desktop && !workspace.groups.length && !errors[project]) {
      // oxlint-disable-next-line react/set-state-in-effect
      void start(project);
    }
  }, [visible, project, workspace.groups.length, errors, start]);
  useEffect(() => {
    function command(event: Event) {
      const action = (
        event as CustomEvent<
          | string
          | { type: "run"; project: string; file: string; done: () => void }
        >
      ).detail;
      if (typeof action === "object" && action.type === "run") {
        void start(action.project, { fresh: true, file: action.file }).finally(
          action.done,
        );
        return;
      }
      if (!project) return;
      if (action === "new") void start(project!, { fresh: true });
      else if (action === "split" && group)
        void start(project!, { fresh: true, splitGroup: group.id });
      else
        panel.current
          ?.querySelector<HTMLTextAreaElement>(
            "[data-terminal-focused=true] .xterm-helper-textarea",
          )
          ?.focus();
    }
    window.addEventListener("oiagent-project-terminal", command);
    return () =>
      window.removeEventListener("oiagent-project-terminal", command);
  }, [project, group, start]);
  async function stop() {
    if (!task || task.status !== "running") return;
    try {
      update(await call<Task>("stop_task", { id: task.id }));
    } catch (error) {
      toast.error(String(error));
    }
  }

  return (
    <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
      <ResizablePanel id="project-editor" minSize="20%">
        <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
          {children}
        </div>
      </ResizablePanel>
      {visible && (
        <>
          <ResizableHandle className="h-px w-full" aria-label="调整终端高度" />
          <ResizablePanel
            id="project-terminal"
            defaultSize="35%"
            minSize="140px"
            maxSize="75%"
          >
            <section
              ref={panel}
              aria-label="项目终端"
              className="flex h-full min-h-0 flex-col bg-background"
            >
              <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/50 px-2 text-xs">
                <span className="px-1 font-medium">终端</span>
                <div
                  className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
                  role="group"
                  aria-label="终端会话"
                >
                  {workspace.groups.map((item) => (
                    <Button
                      key={item.id}
                      size="xs"
                      variant={group?.id === item.id ? "secondary" : "ghost"}
                      onClick={() =>
                        dispatch({ type: "select", project, group: item.id })
                      }
                      aria-pressed={group?.id === item.id}
                      aria-label={`终端 ${item.number}`}
                      title={
                        item.panes.length > 1
                          ? `${item.panes.length} 个分栏`
                          : state.sessions[item.focused]?.title
                      }
                    >
                      {item.panes.length > 1 ? (
                        <Columns2 className="size-3.5" />
                      ) : (
                        <SquareTerminal className="size-3.5" />
                      )}
                      <span className="max-w-40 truncate">
                        {state.sessions[item.focused]?.title.startsWith("运行 ")
                          ? state.sessions[item.focused].title
                          : item.number}
                      </span>
                      {item.panes.length > 1 && (
                        <span className="text-muted-foreground">
                          · {item.panes.length}
                        </span>
                      )}
                      {item.panes.some(
                        (id) => state.sessions[id]?.status === "stopping",
                      ) && (
                        <span role="status" aria-label="终止中">
                          <LoaderCircle className="size-3 motion-safe:animate-spin" />
                        </span>
                      )}
                    </Button>
                  ))}
                </div>
                {busy && (
                  <span role="status" aria-label="终端启动中">
                    <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
                  </span>
                )}
                <IconButton
                  label="新建终端"
                  disabled={busy || !desktop}
                  onClick={() => void start(project, { fresh: true })}
                >
                  <Plus />
                </IconButton>
                <IconButton
                  label="拆分终端"
                  disabled={busy || !group || !desktop}
                  onClick={() =>
                    group &&
                    void start(project, { fresh: true, splitGroup: group.id })
                  }
                >
                  <Columns2 />
                </IconButton>
                {group && group.panes.length > 1 && (
                  <IconButton
                    label="取消终端分组"
                    onClick={() =>
                      dispatch({ type: "ungroup", project, group: group.id })
                    }
                  >
                    <PanelsTopLeft />
                  </IconButton>
                )}
                <IconButton
                  label="终止终端"
                  disabled={task?.status !== "running"}
                  onClick={() => void stop()}
                >
                  <Trash2 />
                </IconButton>
                <IconButton label="收起终端" onClick={onClose}>
                  <X />
                </IconButton>
              </div>
              {errors[project] && (
                <div className="flex items-center gap-2 px-3 py-1 text-xs">
                  <span role="alert" className="text-destructive">
                    {errors[project]}
                  </span>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      void start(project, retryOptions.current[project])
                    }
                  >
                    重试
                  </Button>
                </div>
              )}
              {!desktop ? (
                <div className="p-4 text-xs text-muted-foreground">
                  请在桌面版中打开终端
                </div>
              ) : group ? (
                <ResizablePanelGroup
                  key={group.id}
                  orientation="horizontal"
                  className="min-h-0 flex-1"
                  defaultLayout={
                    group.panes.every(
                      (id) => layouts[group.id]?.[id] !== undefined,
                    ) &&
                    Object.keys(layouts[group.id] || {}).length ===
                      group.panes.length
                      ? layouts[group.id]
                      : undefined
                  }
                  onLayoutChanged={(layout) => {
                    setLayouts((current) => {
                      const old = current[group.id];
                      if (
                        old &&
                        Object.keys(old).length ===
                          Object.keys(layout).length &&
                        Object.entries(layout).every(
                          ([id, size]) => old[id] === size,
                        )
                      )
                        return current;
                      return { ...current, [group.id]: layout };
                    });
                  }}
                >
                  {group.panes.map((id, index) => (
                    <Fragment key={id}>
                      {index > 0 && (
                        <ResizableHandle aria-label="调整终端分栏" />
                      )}
                      <ResizablePanel
                        id={id}
                        minSize={`${Math.min(15, 100 / group.panes.length)}%`}
                      >
                        <div
                          data-terminal-focused={group.focused === id}
                          className="flex h-full min-h-0 flex-col"
                          onFocusCapture={() => {
                            if (group.focused !== id)
                              dispatch({
                                type: "focus",
                                project,
                                group: group.id,
                                pane: id,
                              });
                          }}
                        >
                          <PaneBoundary key={id} label="项目终端">
                            <Suspense fallback={loading}>
                              <TerminalView
                                id={id}
                                running={running(state.sessions[id])}
                                active={group.focused === id}
                                shell
                              />
                            </Suspense>
                          </PaneBoundary>
                        </div>
                      </ResizablePanel>
                    </Fragment>
                  ))}
                </ResizablePanelGroup>
              ) : (
                <div className="flex min-h-0 flex-1 items-center justify-center">
                  {!busy && !errors[project] && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void start(project, { fresh: true })}
                    >
                      <Plus />
                      新建终端
                    </Button>
                  )}
                </div>
              )}
            </section>
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}
