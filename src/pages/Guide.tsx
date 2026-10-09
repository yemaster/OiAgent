import { ArrowRight, Check, Circle, FolderOpen, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/workspace/shared";
import { desktop } from "@/lib/api";
import type { Page, Snapshot } from "@/lib/types";
export function GuidePage({
  snapshot,
  onNavigate,
  onAddProject,
  onDismiss,
}: {
  snapshot: Snapshot;
  onNavigate: (page: Page) => void;
  onAddProject: () => void;
  onDismiss: () => void;
}) {
  const available = snapshot.agents.filter((a) => a.available);
  const steps = [
    {
      title: "配置 Agent",
      description: available.length
        ? `已检测到 ${available.length} 个可用程序，可在 Agent 程序中管理。`
        : "安装并登录 Agent 后，扫描本机程序或手动添加。",
      done: available.length > 0,
      action: "管理程序",
      run: () => onNavigate("agents"),
    },
    {
      title: "打开项目",
      description: "选择工作目录，任务和历史记录按项目保存。",
      done: snapshot.projects.length > 0,
      action: "打开文件夹",
      run: onAddProject,
    },
    {
      title: "新建任务",
      description: "选择 Agent，输入任务内容并启动。",
      done: snapshot.tasks.some((t) => t.source === "managed"),
      action: "新建任务",
      run: () => onNavigate("new"),
    },
  ];
  return (
    <div className="mx-auto max-w-4xl px-6 py-9 lg:px-10 lg:py-12">
      <PageHeading title="欢迎使用 OiAgent">
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          查看当前任务
          <ArrowRight />
        </Button>
      </PageHeading>
      {!desktop && (
        <p className="mb-7 rounded-md bg-muted px-4 py-3 text-xs leading-5 text-muted-foreground">
          浏览器演示模式。管理本机程序、文件和任务请使用桌面版。
        </p>
      )}
      <div className="grid gap-10 lg:grid-cols-[1.35fr_1fr]">
        <section>
          <h2 className="mb-2 text-sm font-semibold">开始</h2>
          <ol className="divide-y">
            {steps.map((step, i) => (
              <li key={step.title} className="flex gap-3 py-5">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                  {step.done ? (
                    <Check className="size-4" aria-label="已完成" />
                  ) : (
                    <span className="text-xs tabular-nums">{i + 1}</span>
                  )}
                </span>
                <div>
                  <h3 className="text-sm font-medium">{step.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-6 text-muted-foreground">
                    {step.description}
                  </p>
                  <Button
                    variant={i === 2 ? "default" : "outline"}
                    size="sm"
                    onClick={step.run}
                    className="mt-3 text-xs shadow-none"
                  >
                    {step.action}
                    <ArrowRight className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section className="space-y-7">
          <div className="rounded-lg border p-5">
            <h2 className="text-sm font-semibold">历史记录</h2>
            <p className="my-3 text-[13px] leading-6 text-muted-foreground">
              按项目查看 Codex、Claude Code 和 Qwen Code 的本机会话记录。
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onNavigate("history")}
              className="text-xs shadow-none"
            >
              <History className="size-3.5" />
              查看历史记录
            </Button>
          </div>
          <div>
            <h2 className="mb-3 text-sm font-semibold">配置与扩展</h2>
            <div className="divide-y">
              <button
                onClick={() => onNavigate("supervisor")}
                className="flex w-full gap-4 py-3 text-left focus-visible:outline-ring"
              >
                <div className="flex-1">
                  <span className="text-[13px] font-medium">自动化</span>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    拆分并依次执行子任务。需要配置 LLM API。
                  </p>
                </div>
                <ArrowRight className="mt-1 size-3.5 text-muted-foreground" />
              </button>
              <button
                onClick={() => onNavigate("plugins")}
                className="flex w-full gap-4 py-3 text-left focus-visible:outline-ring"
              >
                <div className="flex-1">
                  <span className="text-[13px] font-medium">插件</span>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    安装和管理 Agent 扩展。
                  </p>
                </div>
                <ArrowRight className="mt-1 size-3.5 text-muted-foreground" />
              </button>
            </div>
          </div>
        </section>
      </div>
      <details className="mt-8 border-t pt-5 text-[13px]">
        <summary className="w-fit cursor-pointer font-medium">
          任务状态说明
        </summary>
        <dl className="mt-4 grid gap-x-8 gap-y-4 text-xs sm:grid-cols-2">
          <div>
            <dt className="flex items-center gap-2 font-medium">
              <Circle className="size-3 text-amber-600" />
              等待操作
            </dt>
            <dd className="mt-1.5 leading-5 text-muted-foreground">
              需要确认权限或补充信息，请打开任务详情处理。
            </dd>
          </div>
          <div>
            <dt className="font-medium">进行中 / 待启动</dt>
            <dd className="mt-1.5 leading-5 text-muted-foreground">
              进行中：正在执行。待启动：已保存，等待手动启动。
            </dd>
          </div>
          <div>
            <dt className="font-medium">历史会话</dt>
            <dd className="mt-1.5 leading-5 text-muted-foreground">
              从 Agent 的本地会话记录导入。
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-2 font-medium">
              <FolderOpen className="size-3" />
              归档记录
            </dt>
            <dd className="mt-1.5 leading-5 text-muted-foreground">
              在「任务信息」中归档，在「历史记录」中恢复。
            </dd>
          </div>
        </dl>
      </details>
    </div>
  );
}
