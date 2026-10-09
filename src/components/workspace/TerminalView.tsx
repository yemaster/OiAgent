import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { call, desktop } from "@/lib/api";
function terminalTheme(dark: boolean) {
  return dark
    ? {
        background: "#262626",
        foreground: "#fafafa",
        cursor: "#fafafa",
        selectionBackground: "#525252",
        black: "#737373",
        brightBlack: "#a3a3a3",
      }
    : {
        background: "#ffffff",
        foreground: "#242424",
        cursor: "#424240",
        selectionBackground: "#e4e4e1",
        black: "#242424",
        brightBlack: "#777773",
      };
}
export function TerminalView({
  id,
  active = true,
  running = true,
}: {
  id: string;
  active?: boolean;
  running?: boolean;
}) {
  const [hasOutput, setHasOutput] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (!ref.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "Menlo, Monaco, Consolas, monospace",
      theme: terminalTheme(document.documentElement.classList.contains("dark")),
      scrollback: 10000,
      allowProposedApi: false,
    });
    terminal.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    try {
      term.open(ref.current);
    } catch (e) {
      // The xterm constructor is an external system; report initialization failure locally.
      // oxlint-disable-next-line react/set-state-in-effect
      setConnectionError(String(e));
      term.dispose();
      terminal.current = null;
      return;
    }
    let offset = 0;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let reported = false;
    const resize = () => {
      try {
        if (!ref.current?.clientWidth || !ref.current.clientHeight) return;
        fit.fit();
        if (desktop)
          void call("terminal_resize", {
            id,
            cols: term.cols,
            rows: term.rows,
          }).catch(() => {});
      } catch {
        /* Container can briefly be hidden during transitions. */
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(ref.current);
    resize();
    const input = term.onData(
      (data) =>
        void call("terminal_write", { id, data }).catch((e) => {
          if (!reported) {
            term.writeln(`\r\n${String(e)}`);
            reported = true;
          }
        }),
    );
    async function poll() {
      try {
        const bytes = await call<number[]>("terminal_read", { id, offset });
        if (!disposed && bytes.length) {
          setHasOutput(true);
          setConnectionError("");
          term.write(new Uint8Array(bytes));
          offset += bytes.length;
        }
      } catch (e) {
        if (!disposed && !reported) {
          setConnectionError(String(e));
          term.writeln(String(e));
          reported = true;
        }
      } finally {
        if (!disposed) timer = setTimeout(poll, 200);
      }
    }
    if (desktop) void poll();
    else term.writeln("浏览器预览不连接本机终端。请启动桌面版。");
    // The active tab focuses the terminal in its own effect.
    return () => {
      disposed = true;
      clearTimeout(timer);
      input.dispose();
      observer.disconnect();
      terminal.current = null;
      term.dispose();
    };
  }, [id]);
  useEffect(() => {
    if (terminal.current)
      terminal.current.options.theme = terminalTheme(resolvedTheme === "dark");
  }, [resolvedTheme]);
  useEffect(() => {
    if (active) terminal.current?.focus();
  }, [active, id]);
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-card">
      <div
        ref={ref}
        data-terminal-surface
        onPointerDown={() => terminal.current?.focus()}
        onWheel={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        className="absolute inset-0 overflow-hidden overscroll-contain p-3"
        aria-label="交互终端"
      />
      {(!hasOutput || connectionError) && (
        <div
          className="pointer-events-none absolute inset-x-4 top-4 rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground"
          role={connectionError ? "alert" : "status"}
        >
          {connectionError ||
            (running
              ? "终端已打开，等待 Agent TUI 输出…"
              : "终端进程已退出，没有可显示的输出。请重新连接。")}
        </div>
      )}
    </div>
  );
}
