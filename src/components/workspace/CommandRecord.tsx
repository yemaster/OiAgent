import { useMemo, type ReactNode } from "react";
import { ChevronRight, Copy, LoaderCircle, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContextActions } from "./ContextActions";
import { copyText } from "@/lib/clipboard";
import { parseCommands } from "@/lib/commands";
import { cleanCommandOutput } from "@/lib/sessionActivity";
import { plain, record } from "@/lib/transcript";
import type { ToolEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

type Entry = { command: string; cwd?: string; shell?: boolean };
type RecordProps = {
  entries: Entry[];
  summary: string;
  output: string;
  state: "running" | "completed" | "failed" | "unknown";
  exitCode?: number;
  project?: string;
  id?: string;
  open: boolean;
  onOpen: (open: boolean) => void;
  raw?: ToolEvent;
  children?: ReactNode;
};

/** Keep the existing tool row hierarchy; disclose only this command's details. */
export function CommandRecord({
  entries,
  summary,
  output,
  state,
  exitCode,
  project,
  id,
  open,
  onOpen,
  raw,
  children,
}: RecordProps) {
  const command = entries.map((entry) => entry.command).join("\n\n");
  const text = [command, output].filter(Boolean).join("\n\n");
  const status = {
    running: "正在运行",
    completed: "已完成",
    failed: "执行失败",
    unknown: "未记录结果",
  }[state];
  return (
    <ContextActions
      actions={[
        {
          label: "复制命令",
          action: () => void copyText(command),
          disabled: !command,
        },
        {
          label: "复制执行结果",
          action: () => void copyText(output),
          disabled: !output,
        },
        ...(raw
          ? [
              {
                label: "复制原始事件",
                separator: true,
                action: () => void copyText(JSON.stringify(raw, null, 2)),
              },
            ]
          : []),
      ]}
    >
      <details
        className="group/step my-1 min-w-0"
        data-tool-id={id}
        open={open}
      >
        <summary
          onClick={(event) => {
            event.preventDefault();
            onOpen(!open);
          }}
          className="flex cursor-pointer list-none items-center gap-2 rounded-md px-1 py-2 text-xs transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
        >
          {state === "running" ? (
            <LoaderCircle className="size-3.5 shrink-0 text-muted-foreground motion-safe:animate-spin" />
          ) : (
            <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <code className="min-w-0 flex-1 truncate" title={summary}>
            {summary}
          </code>
          <span
            className={cn(
              "shrink-0 text-[11px] text-muted-foreground",
              state === "failed" && "text-destructive",
            )}
          >
            {status}
          </span>
          <ChevronRight className="size-3 shrink-0 transition-transform group-open/step:rotate-90 motion-reduce:transition-none" />
        </summary>
        {open && (
          <>
            <section
              aria-label="命令执行详情"
              className="relative my-2 overflow-hidden rounded-lg border border-border/60 bg-muted/30"
            >
              <Button
                variant="ghost"
                size="icon-xs"
                className="absolute right-1 top-1 z-10 bg-muted"
                aria-label="复制执行记录"
                onClick={() => void copyText(text)}
              >
                <Copy className="size-3" />
              </Button>
              <div className="max-h-[min(24rem,45dvh)] overflow-auto p-3 pr-9 font-mono text-xs leading-5">
                {entries.map((entry, index) => (
                  <div key={index} className={index ? "mt-3" : undefined}>
                    {entry.cwd && entry.cwd !== project && (
                      <p className="mb-1 break-all text-[11px] text-muted-foreground">
                        {entry.cwd}
                      </p>
                    )}
                    <pre className="whitespace-pre-wrap break-words text-foreground">
                      {entry.shell === false ? "" : "$ "}
                      {entry.command}
                    </pre>
                  </div>
                ))}
                {output && (
                  <pre className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">
                    {output}
                  </pre>
                )}
              </div>
              {exitCode !== undefined && exitCode !== 0 && (
                <p className="px-3 pb-2 text-right text-xs text-destructive">
                  退出码 {exitCode}
                </p>
              )}
            </section>
            {children}
          </>
        )}
      </details>
    </ContextActions>
  );
}

export function CommandExecution({
  tool,
  ...props
}: Omit<RecordProps, "entries" | "summary" | "output" | "raw"> & {
  tool: ToolEvent;
}) {
  const content = useMemo(() => {
    const parsed = parseCommands(tool.name, tool.input);
    const args = record(tool.input);
    // Conditional/unresolved scripts stay intact; inferred branches are not an
    // execution trace. Never evaluate scripts merely to display a command.
    const literal =
      parsed.calls.length > 0 &&
      !parsed.unresolved &&
      parsed.calls.every((call) => !!call.command);
    const entries: Entry[] = literal
      ? parsed.calls.map((call) => ({ command: call.command!, cwd: call.cwd }))
      : [
          {
            command:
              typeof tool.input === "string"
                ? tool.input
                : plain(args.code || args.script || tool.input),
            cwd: plain(args.workdir || args.cwd) || undefined,
            shell: false,
          },
        ];
    return {
      entries,
      summary: literal
        ? entries.length > 1
          ? `${entries.length} 条命令`
          : entries[0].command.split("\n")[0]
        : "工具脚本",
      output: cleanCommandOutput(tool.output),
    };
  }, [tool.name, tool.input, tool.output]);
  return <CommandRecord {...props} {...content} raw={tool} />;
}
