import { useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { desktop } from "@/lib/api";
import type { Page } from "@/lib/types";

const itemClass =
  "h-full rounded-none px-2 text-[11px] font-normal focus-visible:ring-inset";

export function WorkspaceStatusBar({
  activeCount,
  availableAgents,
  dataDir,
  refreshing,
  autoRefresh,
  warnings,
  error,
  onTasks,
  onNavigate,
  onRefresh,
}: {
  activeCount: number;
  availableAgents: number;
  dataDir: string;
  refreshing: boolean;
  autoRefresh: boolean;
  warnings: string[];
  error: string;
  onTasks: () => void;
  onNavigate: (page: Page) => void;
  onRefresh: () => void;
}) {
  const [panel, setPanel] = useState<"connection" | "sync" | null>(null);
  function navigate(page: Page) {
    setPanel(null);
    onNavigate(page);
  }
  const syncLabel = refreshing
    ? "正在同步…"
    : error
      ? "同步失败"
      : warnings.length
        ? `${warnings.length} 个目录读取提示`
        : "同步";
  return (
    <footer
      aria-label="工作区状态栏"
      className="flex h-6 shrink-0 items-center border-t border-border/60 bg-card px-2 text-muted-foreground"
    >
      <Popover
        open={panel === "connection"}
        onOpenChange={(open) => setPanel(open ? "connection" : null)}
      >
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            className={itemClass}
            title="查看连接信息"
          >
            <span
              className={`size-1.5 rounded-full ${desktop ? "bg-emerald-500" : "bg-muted-foreground"}`}
            />
            {desktop ? "本地连接" : "演示模式"}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          aria-label="连接信息"
          className="w-80 max-w-[calc(100vw-1rem)] p-3"
        >
          <h2 className="text-sm font-medium">
            {desktop ? "本机" : "演示模式"}
          </h2>
          <dl className="space-y-3 text-xs">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">可用 Agent</dt>
              <dd>{availableAgents}</dd>
            </div>
            {desktop && dataDir && (
              <div className="space-y-1">
                <dt className="text-muted-foreground">数据目录</dt>
                <dd className="break-all select-text leading-5">{dataDir}</dd>
              </div>
            )}
          </dl>
          <div className="flex flex-wrap gap-1 border-t border-border/60 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("agents")}
            >
              管理 Agent
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(desktop ? "settings-lan" : "guide")}
            >
              {desktop ? "局域网连接" : "使用指南"}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="xs"
        className={itemClass}
        title="查看当前任务"
        onClick={() => {
          setPanel(null);
          onTasks();
        }}
      >
        {activeCount} 个活跃任务
      </Button>
      <div className="ml-auto h-full min-w-0">
        <Popover
          open={panel === "sync"}
          onOpenChange={(open) => setPanel(open ? "sync" : null)}
        >
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className={`${itemClass} max-w-full`}
              title="查看同步状态"
            >
              {refreshing ? (
                <RefreshCw className="animate-spin motion-reduce:animate-none" />
              ) : error || warnings.length ? (
                <AlertCircle />
              ) : (
                <RefreshCw />
              )}
              <span className="truncate">{syncLabel}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            aria-label="同步状态"
            className="w-96 max-w-[calc(100vw-1rem)] p-3"
          >
            <h2 className="text-sm font-medium">同步状态</h2>
            <div className="flex items-center justify-between gap-4 text-xs">
              <span className="text-muted-foreground">自动同步</span>
              <span>{autoRefresh ? "已开启" : "已关闭"}</span>
            </div>
            {error && (
              <p
                role="alert"
                className="max-h-32 overflow-y-auto break-words text-xs text-destructive"
              >
                {error}
              </p>
            )}
            {warnings.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-medium">目录读取提示</h3>
                <ul className="max-h-56 space-y-2 overflow-y-auto text-xs leading-5 text-muted-foreground">
                  {warnings.map((warning, index) => (
                    <li key={`${index}:${warning}`} className="break-words">
                      {warning}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!refreshing && !error && !warnings.length && (
              <p className="text-xs text-muted-foreground">无读取异常</p>
            )}
            <div className="flex items-center gap-2 border-t border-border/60 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={refreshing}
                onClick={onRefresh}
              >
                {refreshing ? "正在同步…" : "立即同步"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("settings")}
              >
                同步设置
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </footer>
  );
}
