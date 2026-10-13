import {
  useSendShortcut,
  sendShortcutLabel,
  matchesSendShortcut,
} from "@/lib/shortcuts";
import { ArrowUp, LoaderCircle, Play, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Choice } from "./shared";
import { remotePermissions } from "@/lib/lan";
import { permissionOptions } from "@/lib/permissions";
import type { ReactNode } from "react";
import { isActive, type Task } from "@/lib/types";

export function ConversationComposer({
  task,
  busy,
  canContinue,
  prompt,
  permission,
  onPrompt,
  onPermission,
  onSend,
  onStart,
  onStop,
  onRetry,
  onLog,
  configuration,
  options,
  agentKind,
  hasApprovals = false,
}: {
  task: Task;
  busy: boolean;
  canContinue: boolean;
  prompt: string;
  permission: string;
  onPrompt: (value: string) => void;
  onPermission: (value: string) => void;
  onSend: () => void;
  onStart: () => void;
  onStop: () => void;
  onRetry: () => void;
  onLog: () => void;
  configuration?: ReactNode;
  options?: ReactNode;
  agentKind?: string;
  hasApprovals?: boolean;
}) {
  const sendShortcut = useSendShortcut();
  if (
    task.deviceId &&
    (task.deviceOnline === false || task.deviceWritable === false)
  )
    return (
      <p
        role="status"
        className="mx-auto max-w-3xl rounded-lg bg-muted/50 px-4 py-3 text-sm text-muted-foreground"
      >
        {task.deviceOnline === false
          ? "设备未连接"
          : "设备未授权执行，仅可查看"}
      </p>
    );
  if (!canContinue)
    return (
      <div
        className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-xl bg-muted/50 px-4 py-3"
        aria-label="任务操作"
      >
        <div
          className="min-w-0 flex-1 text-sm text-muted-foreground"
          role="status"
        >
          {task.status === "running" ? (
            <span className="flex items-center gap-2">
              <LoaderCircle className="size-4 shrink-0 animate-spin" />
              正在执行
            </span>
          ) : task.status === "waiting" ? (
            "等待操作"
          ) : task.status === "queued" ? (
            "待启动"
          ) : task.subagentId ? (
            "子 Agent 执行记录"
          ) : (
            "此记录不支持续聊"
          )}
        </div>
        {task.status === "waiting" && (
          <Button size="sm" variant="ghost" onClick={onLog}>
            {hasApprovals ? "处理操作" : "查看原因"}
          </Button>
        )}
        {task.status === "queued" ? (
          <Button size="sm" disabled={busy} onClick={onStart}>
            <Play />
            启动任务
          </Button>
        ) : isActive(task) ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onStop}
            >
              <Square />
              停止
            </Button>
            {task.status === "waiting" && (
              <Button size="sm" disabled={busy} onClick={onRetry}>
                重新配置
              </Button>
            )}
          </>
        ) : (
          !task.subagentId && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RotateCcw />
              重新运行
            </Button>
          )
        )}
      </div>
    );
  const queued = isActive(task);
  const sendLabel = queued ? "添加到消息队列" : "发送消息";
  return (
    <div className="mx-auto max-w-3xl rounded-2xl border bg-card p-3 shadow-xs transition-shadow focus-within:ring-2 focus-within:ring-ring/15">
      <Textarea
        aria-label="继续对话"
        placeholder={queued ? "补充消息，稍后执行…" : "继续这个任务…"}
        disabled={busy}
        value={prompt}
        onChange={(e) => onPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (matchesSendShortcut(e.nativeEvent, sendShortcut)) {
            e.preventDefault();
            if (!busy && prompt.trim()) onSend();
          }
        }}
        className="max-h-48 min-h-20 resize-none border-0 bg-transparent p-2 text-sm leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div
          role="group"
          aria-label="Agent 与权限"
          className="flex min-w-0 flex-wrap items-center gap-1"
        >
          {configuration}
          <Choice
            label="后续任务权限"
            value={permission}
            disabled={busy}
            onChange={onPermission}
            options={(task.deviceId ? remotePermissions : permissionOptions)(
              agentKind || task.agentKind,
            )}
            className="h-7 max-w-52 border-0 bg-transparent text-xs text-muted-foreground shadow-none"
          />
        </div>
        <div
          role="group"
          aria-label="消息操作"
          className="ml-auto flex shrink-0 items-center gap-1"
        >
          {options}
          {task.status === "waiting" && (
            <Button size="sm" variant="ghost" onClick={onLog}>
              {hasApprovals ? "处理操作" : "查看原因"}
            </Button>
          )}
          {queued && (
            <Button
              size="icon"
              variant="ghost"
              className="rounded-full text-muted-foreground"
              aria-label={task.status === "queued" ? "启动任务" : "停止任务"}
              title={task.status === "queued" ? "启动任务" : "停止任务"}
              disabled={busy}
              onClick={task.status === "queued" ? onStart : onStop}
            >
              {task.status === "queued" ? <Play /> : <Square />}
            </Button>
          )}
          <Button
            size="icon"
            className="rounded-full"
            aria-label={sendLabel}
            title={`${sendShortcutLabel(sendShortcut)} ${sendLabel} · Shift + Enter 换行`}
            disabled={!prompt.trim() || busy}
            onClick={onSend}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
      </div>
    </div>
  );
}
