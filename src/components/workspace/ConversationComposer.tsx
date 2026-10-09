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
  agentKind,
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
  agentKind?: string;
}) {
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
          ? "设备未连接，恢复连接后可继续操作。"
          : "该设备未授权执行任务，仅可查看记录。"}
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
              Agent 正在执行任务
            </span>
          ) : task.status === "waiting" ? (
            <>
              <span className="font-medium text-foreground">
                任务需要操作。
              </span>
              <span className="mt-1 block text-xs">
                查看阻塞原因，调整配置或通过交互终端继续。
              </span>
            </>
          ) : task.status === "queued" ? (
            "任务已就绪，等待启动"
          ) : task.subagentId ? (
            "这是子 Agent 的执行记录，可返回父会话继续。"
          ) : (
            "此记录不支持直接续聊，可用原配置新建任务。"
          )}
        </div>
        {task.status === "waiting" && (
          <Button size="sm" variant="ghost" onClick={onLog}>
            查看原因
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
  return (
    <div className="mx-auto max-w-3xl rounded-2xl border bg-background p-2 shadow-xs focus-within:border-ring/50">
      {configuration}
      {isActive(task) && (
        <div className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground">
          <span className="flex-1">
            {task.status === "waiting"
              ? "等待操作，追加消息暂不执行"
              : task.status === "queued"
                ? "待启动，追加消息在首轮之后执行"
                : "运行中，追加消息将在本轮结束后执行"}
          </span>
          {task.status === "waiting" && (
            <Button size="xs" variant="ghost" onClick={onLog}>
              查看原因
            </Button>
          )}
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={task.status === "queued" ? onStart : onStop}
          >
            {task.status === "queued" ? <Play /> : <Square />}
            {task.status === "queued" ? "启动" : "停止"}
          </Button>
        </div>
      )}
      <Textarea
        aria-label="继续对话"
        placeholder={isActive(task) ? "补充要求或安排下一步…" : "继续这个任务…"}
        disabled={busy}
        value={prompt}
        onChange={(e) => onPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            (e.metaKey || e.ctrlKey) &&
            !e.nativeEvent.isComposing
          ) {
            e.preventDefault();
            if (!busy && prompt.trim()) onSend();
          }
        }}
        className="max-h-48 min-h-16 resize-none border-0 bg-transparent px-3 shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <Choice
          label="后续任务权限"
          value={permission}
          onChange={onPermission}
          options={(task.deviceId ? remotePermissions : permissionOptions)(
            agentKind || task.agentKind,
          )}
          className="h-7 border-0 text-xs text-muted-foreground"
        />
        <Button
          size="icon-sm"
          aria-label={isActive(task) ? "添加到消息队列" : "发送消息"}
          title="⌘ / Ctrl + Enter 发送"
          disabled={!prompt.trim() || busy}
          onClick={onSend}
        >
          {busy ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}
        </Button>
      </div>
    </div>
  );
}
