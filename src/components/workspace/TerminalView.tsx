import { useAppearance } from "@/lib/appearance";
import { terminalPalette } from "@/lib/terminalTheme";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import type { Terminal } from "@xterm/xterm";
import {
  takeTerminalSession,
  type TerminalSession,
  releaseTerminalSession,
} from "@/lib/terminalSession";
import "@xterm/xterm/css/xterm.css";

export function TerminalView({
  id,
  active = true,
  running = true,
  shell = false,
}: {
  id: string;
  active?: boolean;
  running?: boolean;
  shell?: boolean;
}) {
  const [hasOutput, setHasOutput] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const sessionRef = useRef<TerminalSession | null>(null);
  const { resolvedTheme } = useTheme();
  const { terminalTheme, surfaces } = useAppearance();
  const surface =
    surfaces[resolvedTheme === "dark" ? "dark" : "light"].background;
  const palette = terminalPalette(terminalTheme, resolvedTheme, surface);
  const latestPalette = useRef(palette);
  useLayoutEffect(() => {
    latestPalette.current = palette;
  }, [palette]);
  useEffect(() => {
    if (!ref.current) return;
    const session = takeTerminalSession(id, latestPalette.current);
    terminal.current = session.term;
    sessionRef.current = session;
    try {
      session.attach(ref.current, latestPalette.current, (status) => {
        setHasOutput(status.hasOutput);
        setConnectionError(status.error);
      });
    } catch (error) {
      // oxlint-disable-next-line react/set-state-in-effect
      setConnectionError(String(error));
      session.dispose();
      terminal.current = null;
      return;
    }
    return () => {
      terminal.current = null;
      sessionRef.current = null;
      releaseTerminalSession(session);
    };
  }, [id]);
  useEffect(() => {
    if (terminal.current)
      terminal.current.options.theme = terminalPalette(
        terminalTheme,
        resolvedTheme,
        surface,
      );
  }, [resolvedTheme, terminalTheme, surface]);
  useEffect(() => {
    sessionRef.current?.setRunning(running);
  }, [running, id]);
  useEffect(() => {
    if (active) terminal.current?.focus();
  }, [active, id]);
  return (
    <div
      className="relative min-h-0 flex-1 overflow-hidden"
      style={{ backgroundColor: palette.background }}
    >
      <div
        ref={ref}
        data-terminal-surface
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
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
              ? shell
                ? "正在打开终端…"
                : "终端已打开，等待 Agent TUI 输出…"
              : "终端进程已退出，没有可显示的输出。请重新连接。")}
        </div>
      )}
    </div>
  );
}
