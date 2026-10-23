import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { call, desktop } from "@/lib/api";
import { terminalClipboard, terminalKeyHandler } from "@/lib/terminalClipboard";
import { toast } from "sonner";

type Status = { hasOutput: boolean; error: string };

/** Keep the parser, partial UTF-8/ANSI sequences and read offset together. */
export class TerminalSession {
  readonly term: Terminal;
  readonly host = document.createElement("div");
  private readonly fit = new FitAddon();
  private offset = 0;
  private disposed = false;
  private attached = false;
  private reading = false;
  private idleReads = 0;
  private running = true;
  setRunning(running: boolean) {
    if (this.running === running) return;
    this.running = running;
    this.wake();
  }
  private wake = () => {
    this.idleReads = 0;
    clearTimeout(this.timer);
    if (
      this.attached &&
      !this.disposed &&
      document.visibilityState !== "hidden"
    )
      void this.poll();
  };
  private timer?: ReturnType<typeof setTimeout>;
  private observer?: ResizeObserver;
  private frame = 0;
  private size = "";
  private resizing = Promise.resolve();
  readonly id: string;
  private status: Status = { hasOutput: false, error: "" };
  private notify?: (status: Status) => void;
  private input = Promise.resolve();
  private menuAction = (event: Event) => {
    if (!this.attached || !this.host.contains(document.activeElement)) return;
    const action = (event as CustomEvent<string>).detail;
    if (action === "terminal-select-all") this.term.selectAll();
    else if (action === "terminal-copy") {
      const text = this.term.getSelection();
      if (text)
        void terminalClipboard
          .write(text)
          .catch(() => toast.error("复制失败，请重试"));
    } else if (action === "terminal-paste") {
      void terminalClipboard
        .read()
        .then((text) => {
          if (
            text &&
            this.attached &&
            !this.disposed &&
            this.host.contains(document.activeElement)
          )
            this.term.paste(text);
        })
        .catch(() => toast.error("读取剪贴板失败，请重试"));
    }
  };
  private inputSubscription;

  constructor(id: string, theme: ITheme) {
    this.id = id;
    this.host.style.cssText = "width:100%;height:100%;overflow:hidden";
    this.term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "Menlo, Monaco, Consolas, monospace",
      theme,
      scrollback: 10000,
      allowProposedApi: false,
    });
    this.term.loadAddon(this.fit);
    this.term.attachCustomKeyEventHandler(
      terminalKeyHandler(
        this.term,
        () =>
          this.attached &&
          !this.disposed &&
          this.host.contains(document.activeElement),
        (error) => toast.error(error),
      ),
    );
    this.inputSubscription = this.term.onData((data) => {
      // Preserve paste/control-key order across async native invocations.
      this.input = this.input
        .then(async () => {
          if (this.disposed) return;
          await call("terminal_write", { id, data });
          this.wake();
        })
        .catch((error) => this.update({ error: String(error) }));
    });
  }

  attach(
    container: HTMLElement,
    theme: ITheme,
    notify: (status: Status) => void,
  ) {
    this.attached = true;
    this.idleReads = 0;
    document.addEventListener("visibilitychange", this.wake);
    this.host.addEventListener("focusin", this.wake);
    window.addEventListener("oiagent-terminal-menu", this.menuAction);
    this.notify = notify;
    container.appendChild(this.host);
    this.term.options.theme = theme;
    if (!this.term.element) this.term.open(this.host);
    notify(this.status);
    const resize = () => {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => {
        if (!this.attached || !this.host.clientWidth || !this.host.clientHeight)
          return;
        this.fit.fit();
        const size = `${this.term.cols}:${this.term.rows}`;
        // ConPTY resize redraws the TUI. Do not send duplicate sizes on every observer event.
        if (desktop && this.size !== size) {
          this.size = size;
          const { cols, rows } = this.term;
          this.resizing = this.resizing
            .then(async () => {
              if (this.disposed || this.size !== size) return;
              await call("terminal_resize", { id: this.id, cols, rows });
            })
            .catch(() => {
              if (this.size === size) this.size = "";
            });
        }
      });
    };
    this.observer = new ResizeObserver(resize);
    this.observer.observe(container);
    resize();
    if (desktop) void this.poll();
    else if (!this.status.hasOutput) {
      this.term.writeln("浏览器预览不连接本机终端。请启动桌面版。");
      this.update({ hasOutput: true });
    }
  }

  detach() {
    this.attached = false;
    document.removeEventListener("visibilitychange", this.wake);
    this.host.removeEventListener("focusin", this.wake);
    window.removeEventListener("oiagent-terminal-menu", this.menuAction);
    this.notify = undefined;
    clearTimeout(this.timer);
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.term.blur();
    this.host.remove();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (leased.get(this.id) === this) leased.delete(this.id);
    if (detached.get(this.id) === this) detached.delete(this.id);
    this.detach();
    this.inputSubscription.dispose();
    this.term.dispose();
  }

  private update(patch: Partial<Status>) {
    if (this.disposed) return;
    const next = { ...this.status, ...patch };
    if (
      next.error === this.status.error &&
      next.hasOutput === this.status.hasOutput
    )
      return;
    this.status = next;
    this.notify?.(next);
  }

  private async poll() {
    if (this.reading || !this.attached || this.disposed) return;
    this.reading = true;
    clearTimeout(this.timer);
    let delay = 200;
    try {
      const bytes = await call<ArrayBuffer | number[]>("terminal_read", {
        id: this.id,
        offset: this.offset,
      });
      if (this.disposed) return;
      const data = new Uint8Array(bytes);
      if (data.byteLength) {
        // Backpressure: at most one read/write chunk is outstanding. Never drop bytes
        // or start in the middle of an ANSI sequence to skip a long transcript.
        await new Promise<void>((resolve) => this.term.write(data, resolve));
        if (this.disposed) return;
        this.offset += data.byteLength;
        this.idleReads = 0;
        this.update({ hasOutput: true, error: "" });
        delay = 0;
      } else {
        // Idle shells cost at most one IPC/read per second; input wakes polling immediately.
        delay = this.running
          ? Math.min(1000, 200 * 2 ** Math.min(this.idleReads++, 3))
          : -1;
        this.update({ error: "" });
      }
    } catch (error) {
      this.update({ error: String(error) });
      delay = 1000;
    } finally {
      this.reading = false;
      if (
        delay >= 0 &&
        this.attached &&
        !this.disposed &&
        document.visibilityState !== "hidden"
      )
        this.timer = setTimeout(() => void this.poll(), delay);
    }
  }
}

// Retain at most four detached views. Keeping the live parser also preserves
// partially received escape/UTF-8 sequences; serializing a text tail cannot do that.
// Eviction disposes only the renderer, never the underlying PTY process.
const detached = new Map<string, TerminalSession>();
const leased = new Map<string, TerminalSession>();
const retired = new WeakSet<TerminalSession>();
// A count limit alone permits four very wide, full 10,000-line buffers.
// This is a cell budget, not a heap-byte estimate (glyphs/renderers vary).
const CACHED_CELLS = 2_000_000;
function cachedCells() {
  let cells = 0;
  for (const { term } of detached.values())
    cells +=
      (term.buffer.normal.length + term.buffer.alternate.length) * term.cols;
  return cells;
}
export function discardTerminalSession(id: string) {
  const session = detached.get(id);
  if (session) {
    session.dispose();
    detached.delete(id);
  } else {
    const live = leased.get(id);
    if (live) retired.add(live);
  }
}

export function takeTerminalSession(id: string, theme: ITheme) {
  const cached = detached.get(id);
  detached.delete(id);
  const session = cached || new TerminalSession(id, theme);
  leased.set(id, session);
  return session;
}
export function releaseTerminalSession(session: TerminalSession) {
  if (leased.get(session.id) === session) leased.delete(session.id);
  session.detach();
  if (retired.delete(session)) {
    session.dispose();
    return;
  }
  const previous = detached.get(session.id);
  if (previous) {
    if (previous === session) return;
    previous.dispose();
    detached.delete(session.id);
  }
  detached.set(session.id, session);
  // Keep the most recent parser even if it alone exceeds the budget, so toggling
  // chat/TUI on a long session does not replay the entire terminal every time.
  while (
    detached.size > 4 ||
    (detached.size > 1 && cachedCells() > CACHED_CELLS)
  ) {
    const [id, oldest] = detached.entries().next().value!;
    oldest.dispose();
    detached.delete(id);
  }
}
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    for (const session of detached.values()) session.dispose();
    for (const session of leased.values()) session.dispose();
    detached.clear();
    leased.clear();
  });
