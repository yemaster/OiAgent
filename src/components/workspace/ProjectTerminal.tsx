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
  Plus,
  RotateCcw,
  Columns2,
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
import { type Task } from "@/lib/types";
import { IconButton } from "./shared";
import { PaneBoundary } from "./PaneBoundary";
import { toast } from "sonner";
// Keep xterm out of the initial application bundle.
function discardTerminalSession(id: string) {
  void import("@/lib/terminalSession").then((module) =>
    module.discardTerminalSession(id),
  );
}

const TerminalView = lazy(() =>
  import("./TerminalView").then((m) => ({ default: m.TerminalView })),
);
type Group = {
  ids: string[];
  selected?: string;
  split?: string;
  focused?: string;
};
const emptyGroup: Group = { ids: [] };
const running = (task?: Task) =>
  task?.status === "running" || task?.status === "stopping";

/** Shells live independently of renderers. Hidden sessions retain their byte cursor and ANSI parser. */
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
  const [groups, setGroups] = useState<Record<string, Group>>({});
  const [pending, setPending] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const requests = useRef(new Map<string, Promise<Task>>());
  const panel = useRef<HTMLElement>(null);
  const visible = open && !!project;
  const group = (project && groups[project]) || emptyGroup;
  const focusedId = group.focused || group.selected;
  const task = focusedId ? sessions[focusedId] : undefined;
  const busy = !!project && pending.includes(project);
  const update = useCallback(
    (next: Task) =>
      setSessions((current) => ({
        ...current,
        [next.id]: newerTask(current[next.id] || next, next),
      })),
    [],
  );

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
    async (
      path: string,
      options: { fresh?: boolean; split?: boolean; replace?: string } = {},
    ) => {
      // Repeated clicks share one request; switching projects never assigns a result to the wrong group.
      if (requests.current.has(path)) return;
      setPending((values) => [...values, path]);
      setErrors((values) => ({ ...values, [path]: "" }));
      const request = call<Task>("project_terminal_start", {
        project: path,
        newSession: !!options.fresh,
      });
      requests.current.set(path, request);
      try {
        const next = await request;
        update(next);
        setGroups((values) => {
          const previous = values[path] || emptyGroup;
          const ids = [
            ...previous.ids.filter(
              (id) => id !== next.id && id !== options.replace,
            ),
            next.id,
          ];
          const split = options.split
            ? next.id
            : !!options.replace && previous.split === options.replace
              ? next.id
              : previous.split;
          return {
            ...values,
            [path]: {
              ids,
              selected:
                options.split ||
                (!!options.replace && previous.split === options.replace)
                  ? previous.selected
                  : next.id,
              split,
              focused: next.id,
            },
          };
        });
        if (options.replace) discardTerminalSession(options.replace);
      } catch (error) {
        setErrors((values) => ({ ...values, [path]: String(error) }));
      } finally {
        requests.current.delete(path);
        setPending((values) => values.filter((value) => value !== path));
      }
    },
    [update],
  );

  useEffect(() => {
    // Synchronize opening a project with its native process only once, including failed starts.
    if (visible && desktop && !groups[project] && !errors[project]) {
      // oxlint-disable-next-line react/set-state-in-effect
      void start(project);
    }
  }, [visible, project, groups, errors, start]);
  useEffect(() => {
    if (!project) return;
    function command(event: Event) {
      const action = (event as CustomEvent<string>).detail;
      if (action === "new") void start(project!, { fresh: true });
      else if (action === "split" && group.selected && !group.split)
        void start(project!, { fresh: true, split: true });
      else
        panel.current
          ?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")
          ?.focus();
    }
    window.addEventListener("oiagent-project-terminal", command);
    return () =>
      window.removeEventListener("oiagent-project-terminal", command);
  }, [project, group.selected, group.split, start]);

  async function stop() {
    if (!task || task.status !== "running") return;
    try {
      update(await call<Task>("stop_task", { id: task.id }));
    } catch (error) {
      toast.error(String(error));
    }
  }
  function select(id: string) {
    if (!project) return;
    setGroups((values) => ({
      ...values,
      [project]: {
        ...values[project],
        selected: id,
        focused: id,
        split: id === values[project].split ? undefined : values[project].split,
      },
    }));
  }
  function remove(id: string) {
    if (!project || running(sessions[id])) return;
    discardTerminalSession(id);
    setGroups((values) => {
      const previous = values[project];
      const ids = previous.ids.filter((value) => value !== id);
      const selected =
        previous.selected === id ? ids.at(-1) : previous.selected;
      return {
        ...values,
        [project]: {
          ids,
          selected,
          focused: selected,
          split:
            previous.split === id || previous.split === selected
              ? undefined
              : previous.split,
        },
      };
    });
    setSessions((values) => {
      const next = { ...values };
      delete next[id];
      return next;
    });
  }
  const renderTerminal = (id: string) => (
    <div
      className="flex h-full min-h-0 flex-col"
      onFocusCapture={() => {
        if (project && group.focused !== id)
          setGroups((values) => ({
            ...values,
            [project]: { ...values[project], focused: id },
          }));
      }}
    >
      <PaneBoundary key={id} label="项目终端">
        <Suspense
          fallback={
            <div className="p-4 text-xs text-muted-foreground">
              正在打开终端…
            </div>
          }
        >
          <TerminalView
            id={id}
            running={running(sessions[id])}
            active={focusedId === id}
            shell
          />
        </Suspense>
      </PaneBoundary>
    </div>
  );
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
                  className="flex min-w-0 flex-1 items-center overflow-x-auto"
                  role="group"
                  aria-label="终端会话"
                >
                  {group.ids.map((id, index) => (
                    <div key={id} className="flex shrink-0 items-center">
                      <Button
                        size="xs"
                        variant={focusedId === id ? "secondary" : "ghost"}
                        onClick={() => select(id)}
                        aria-pressed={focusedId === id}
                        aria-label={`终端 ${index + 1}`}
                      >
                        <SquareTerminal className="size-3.5" />
                        {index + 1}
                        {sessions[id]?.status === "stopping" ? (
                          <LoaderCircle className="size-3 motion-safe:animate-spin" />
                        ) : !running(sessions[id]) ? (
                          <span className="text-muted-foreground">已退出</span>
                        ) : null}
                      </Button>
                      {!running(sessions[id]) && (
                        <IconButton
                          label={`关闭终端 ${index + 1}`}
                          onClick={() => remove(id)}
                        >
                          <X />
                        </IconButton>
                      )}
                    </div>
                  ))}
                </div>
                {busy && (
                  <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
                )}
                {task?.status === "stopping" && (
                  <span className="text-muted-foreground">终止中…</span>
                )}
                <IconButton
                  label="新建终端"
                  disabled={busy || !desktop}
                  onClick={() => void start(project, { fresh: true })}
                >
                  <Plus />
                </IconButton>
                <IconButton
                  label={group.split ? "收起终端分栏" : "拆分终端"}
                  disabled={busy || !group.selected}
                  onClick={() =>
                    group.split
                      ? setGroups((values) => ({
                          ...values,
                          [project]: {
                            ...values[project],
                            split: undefined,
                            focused: values[project].selected,
                          },
                        }))
                      : void start(project, { fresh: true, split: true })
                  }
                >
                  <Columns2 />
                </IconButton>
                {task && !running(task) && (
                  <IconButton
                    label="重新打开终端"
                    disabled={busy}
                    onClick={() =>
                      void start(project, { fresh: true, replace: task.id })
                    }
                  >
                    <RotateCcw />
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
                      void start(project, { fresh: !!group.selected })
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
              ) : group.selected ? (
                <ResizablePanelGroup
                  orientation="horizontal"
                  className="min-h-0 flex-1"
                >
                  <ResizablePanel id="shell-first" minSize="20%">
                    {renderTerminal(group.selected)}
                  </ResizablePanel>
                  {group.split && (
                    <>
                      <ResizableHandle aria-label="调整终端分栏" />
                      <ResizablePanel id="shell-second" minSize="20%">
                        {renderTerminal(group.split)}
                      </ResizablePanel>
                    </>
                  )}
                </ResizablePanelGroup>
              ) : (
                <div className="flex min-h-0 flex-1 items-center justify-center">
                  {busy ? (
                    <LoaderCircle className="size-4 motion-safe:animate-spin" />
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void start(project, { fresh: true })}
                    >
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
