import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import {
  LoaderCircle,
  RotateCcw,
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
import { newerTask } from "@/lib/taskState";
import { projectName, type Task } from "@/lib/types";
import { IconButton } from "./shared";
import { PaneBoundary } from "./PaneBoundary";
import { toast } from "sonner";

const TerminalView = lazy(() =>
  import("./TerminalView").then((m) => ({ default: m.TerminalView })),
);

/** A project shell never owns an Agent conversation. Only the visible renderer polls. */
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
  const [sessions, setSessions] = useState<Record<string, Task>>({});
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const requests = useRef(new Map<string, Promise<Task>>());
  const visible = open && !!project;
  const task = project ? sessions[selected[project]] : undefined;
  const running = task?.status === "running";
  const stopping = task?.status === "stopping";
  const update = useCallback((task: Task) => {
    setSessions((current) => ({
      ...current,
      [task.id]: newerTask(current[task.id] || task, task),
    }));
  }, []);

  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let off: (() => void) | undefined;
    void listen<Task>("project-terminal-changed", ({ payload }) =>
      update(payload),
    )
      .then((unlisten) => {
        if (disposed) unlisten();
        else off = unlisten;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      off?.();
    };
  }, [update]);

  const start = useCallback(
    async (path: string) => {
      setPending(path);
      setErrors((current) => ({ ...current, [path]: "" }));
      let request = requests.current.get(path);
      if (!request) {
        request = call<Task>("project_terminal_start", { project: path });
        requests.current.set(path, request);
      }
      try {
        const next = await request;
        update(next);
        setSelected((current) => ({ ...current, [path]: next.id }));
      } catch (error) {
        setErrors((current) => ({ ...current, [path]: String(error) }));
      } finally {
        if (requests.current.get(path) === request)
          requests.current.delete(path);
        setPending((current) => (current === path ? null : current));
      }
    },
    [update],
  );

  useEffect(() => {
    // Opening a native shell synchronizes the visible project with an external process.
    // oxlint-disable-next-line react/set-state-in-effect
    if (visible && desktop && !selected[project]) void start(project);
    // Opening a panel must not restart a shell which the user has exited.
  }, [visible, project, selected, start]);

  async function stop() {
    if (!task || !running) return;
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
              aria-label="项目终端"
              className="flex h-full min-h-0 flex-col bg-background"
            >
              <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/50 px-3 text-xs">
                <SquareTerminal className="size-3.5 text-muted-foreground" />
                <span className="font-medium">终端</span>
                <span
                  className="min-w-0 truncate text-muted-foreground"
                  title={project}
                >
                  {projectName(project)}
                </span>
                {task && !running && (
                  <span className="text-muted-foreground">
                    {stopping ? "终止中…" : "已退出"}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-0.5">
                  {task && !running && !stopping && (
                    <IconButton
                      label="重新打开终端"
                      disabled={pending === project}
                      onClick={() => void start(project)}
                    >
                      <RotateCcw />
                    </IconButton>
                  )}
                  <IconButton
                    label="终止终端"
                    disabled={!running}
                    onClick={() => void stop()}
                  >
                    <Trash2 />
                  </IconButton>
                  <IconButton label="收起终端" onClick={onClose}>
                    <X />
                  </IconButton>
                </div>
              </div>
              {!desktop ? (
                <div className="p-4 text-xs text-muted-foreground">
                  请在桌面版中打开终端
                </div>
              ) : task ? (
                <PaneBoundary key={task.id} label="项目终端">
                  <Suspense
                    fallback={
                      <div className="p-4 text-xs text-muted-foreground">
                        正在打开终端…
                      </div>
                    }
                  >
                    <TerminalView
                      id={task.id}
                      running={running || stopping}
                      shell
                    />
                  </Suspense>
                </PaneBoundary>
              ) : (
                <div className="flex min-h-0 flex-1 items-center justify-center gap-2 p-4 text-xs text-muted-foreground">
                  {errors[project] ? (
                    <>
                      <span role="alert">{errors[project]}</span>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => void start(project)}
                      >
                        重试
                      </Button>
                    </>
                  ) : (
                    <LoaderCircle className="size-4 motion-safe:animate-spin" />
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
