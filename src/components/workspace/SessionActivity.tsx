import { useMemo, useState } from "react";
import {
  ChevronRight,
  Copy,
  ExternalLink,
  LoaderCircle,
  Server,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "./CodeBlock";
import { ConversationText } from "./Transcript";
import { IconButton } from "./shared";
import { copyText } from "@/lib/clipboard";
import { call, desktop } from "@/lib/api";
import type { Task } from "@/lib/types";
import type { SessionCommand, SessionService } from "@/lib/sessionActivity";

export function SessionProcesses({ commands }: { commands: SessionCommand[] }) {
  const processes = useMemo(
    () => commands.filter((command) => command.state === "running"),
    [commands],
  );
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string>();
  const [limit, setLimit] = useState(40);
  const matches = useMemo(
    () =>
      processes
        .filter((command) =>
          `${command.command}\n${command.summary}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
        )
        .toReversed(),
    [processes, query],
  );
  return (
    <section aria-label="正在运行的进程" className="space-y-3">
      <h3 className="text-sm font-medium">
        正在运行{" "}
        <span className="ml-1 text-xs font-normal text-muted-foreground">
          {processes.length}
        </span>
      </h3>
      {processes.length > 5 && (
        <Input
          aria-label="搜索进程"
          placeholder="搜索进程…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(40);
          }}
        />
      )}
      {!matches.length && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {query ? "没有匹配的进程" : "暂无运行中的进程"}
        </p>
      )}
      <div className="space-y-2">
        {matches.slice(0, limit).map((command) => {
          const open = expanded === command.id;
          return (
            <div
              key={command.id}
              className="overflow-hidden rounded-lg border border-border/60"
            >
              <div className="flex items-start gap-1 pr-1">
                <button
                  className="flex min-w-0 flex-1 items-start gap-2 p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? "" : command.id)}
                >
                  <ChevronRight
                    className={`mt-0.5 size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
                  />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <code
                      className="block truncate text-xs"
                      title={command.command}
                    >
                      {command.command}
                    </code>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />
                      <span>运行中</span>
                      {command.background && <span>· 后台</span>}
                    </div>
                    {command.summary && (
                      <p className="line-clamp-2 break-words text-xs leading-5 text-muted-foreground">
                        {command.summary}
                      </p>
                    )}
                  </div>
                </button>
                <IconButton
                  label="复制命令"
                  className="mt-1"
                  onClick={() => void copyText(command.command)}
                >
                  <Copy />
                </IconButton>
              </div>
              {open && (
                <div className="space-y-3 border-t border-border/60 p-3">
                  {command.cwd && (
                    <p className="break-all text-xs text-muted-foreground">
                      {command.cwd}
                    </p>
                  )}
                  <CodeBlock
                    text={command.command}
                    language={command.language}
                    copyLabel="复制完整命令"
                  />
                  {command.output ? (
                    <CodeBlock
                      text={command.output}
                      label="输出"
                      copyLabel="复制输出"
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">暂无输出</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {matches.length > limit && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => setLimit(limit + 40)}
        >
          加载更多
        </Button>
      )}
    </section>
  );
}
export function SessionServices({
  services,
  task,
}: {
  services: SessionService[];
  task: Task;
}) {
  const [checks, setChecks] = useState<Record<number, boolean>>({});
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const ports = [
    ...new Set(
      services
        .filter((service) => service.local)
        .map((service) => service.port),
    ),
  ];
  async function probe() {
    setChecking(true);
    setError("");
    try {
      const results: { port: number; reachable: boolean }[] = [];
      for (let i = 0; i < ports.length; i += 16)
        results.push(
          ...(await call<{ port: number; reachable: boolean }[]>(
            "probe_service_ports",
            { ports: ports.slice(i, i + 16) },
          )),
        );
      setChecks(
        Object.fromEntries(
          results.map((result) => [result.port, result.reachable]),
        ),
      );
    } catch (error) {
      setError(String(error));
    } finally {
      setChecking(false);
    }
  }
  return (
    <section aria-label="会话服务" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          服务{" "}
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {services.length}
          </span>
        </h3>
        {desktop && !task.deviceId && ports.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            disabled={checking}
            onClick={() => void probe()}
          >
            {checking && <LoaderCircle className="animate-spin" />}
            {checking ? "正在检测…" : "检测端口"}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {!services.length && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          暂无服务启动记录
        </p>
      )}
      {services.map((service) => (
        <div
          key={service.id}
          className="space-y-3 rounded-lg border border-border/60 p-3"
        >
          <div className="flex items-center gap-2">
            <Server className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-mono text-sm">
              {service.host.includes(":") ? `[${service.host}]` : service.host}:
              {service.port}
            </span>
            <Badge variant="secondary" title="端口连通性不代表服务归属">
              {service.local && checks[service.port] !== undefined
                ? checks[service.port]
                  ? "可连接"
                  : "未连接"
                : "未检测"}
            </Badge>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div className="space-y-1">
              <dt className="text-muted-foreground">Host</dt>
              <dd className="break-all font-mono">{service.host}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-muted-foreground">端口</dt>
              <dd className="font-mono">{service.port}</dd>
            </div>
          </dl>
          <code
            className="block truncate text-xs text-muted-foreground"
            title={service.command}
          >
            {service.command}
          </code>
          <div className="flex items-center gap-3 text-xs">
            {service.url && !task.deviceId && (
              <div className="flex items-center gap-1">
                <ExternalLink className="size-3 text-muted-foreground" />
                <ConversationText
                  text={`[打开服务](${service.url})`}
                  project={task.project}
                />
              </div>
            )}
            <Button
              variant="ghost"
              size="xs"
              onClick={() =>
                void copyText(
                  service.url ||
                    `${service.host.includes(":") ? `[${service.host}]` : service.host}:${service.port}`,
                )
              }
            >
              <Copy />
              复制地址
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}
