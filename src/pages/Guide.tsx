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
      title: "确认可用的 Agent",
      description: available.length
        ? `${available.map((a) => a.name).join("、")} 已就绪。也可以添加其他本机程序。`
        : "先在本机安装并登录 Agent（如 Codex、Claude、Gemini 或 OpenCode），再扫描程序。",
      done: available.length > 0,
      action: "管理 Agent",
      run: () => onNavigate("agents"),
    },
    {
      title: "选择项目文件夹",
      description: "Agent 在这个目录里工作，对话记录也会归到对应项目。",
      done: snapshot.projects.length > 0,
      action: "添加项目",
      run: onAddProject,
    },
    {
      title: "描述要完成的工作",
      description: "启动后可以查看实时消息、处理等待操作，或继续对话。",
      done: snapshot.tasks.some((t) => t.source === "managed"),
      action: "新建任务",
      run: () => onNavigate("new"),
    },
  ];
  return (
    <div className="mx-auto max-w-4xl px-6 py-9 lg:px-10 lg:py-12">
      <PageHeading title="开始使用 OiAgent">
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          进入工作台
          <ArrowRight />
        </Button>
      </PageHeading>
      {!desktop && (
        <p className="mb-7 rounded-md bg-muted px-4 py-3 text-xs leading-5 text-muted-foreground">
          当前为界面演示，下面展示的是示例数据。打开桌面 App
          后，会自动发现本机程序和历史对话。
        </p>
      )}
      <div className="grid gap-10 lg:grid-cols-[1.35fr_1fr]">
        <section>
          <h2 className="mb-2 text-sm font-semibold">开始一个任务</h2>
          <ol className="divide-y">
            {steps.map((step, i) => (
              <li key={step.title} className="flex gap-3 py-5">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                  {step.done ? (
                    <Check className="size-4" aria-label="已就绪" />
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
            <h2 className="text-sm font-semibold">找回已有对话</h2>
            <p className="my-3 text-[13px] leading-6 text-muted-foreground">
              Codex、Claude 和 Qwen
              的本机历史会自动按项目整理，不需要重新导入每个会话。
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
            <h2 className="mb-3 text-sm font-semibold">需要时再探索</h2>
            <div className="divide-y">
              <button
                onClick={() => onNavigate("supervisor")}
                className="flex w-full gap-4 py-3 text-left focus-visible:outline-ring"
              >
                <div className="flex-1">
                  <span className="text-[13px] font-medium">自动化</span>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    让超级 Agent 拆分目标、派发任务。需先配置 LLM API。
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
                    接入自定义 Agent，扩展启动方式。
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
          任务状态是什么意思？
        </summary>
        <dl className="mt-4 grid gap-x-8 gap-y-4 text-xs sm:grid-cols-2">
          <div>
            <dt className="flex items-center gap-2 font-medium">
              <Circle className="size-3 text-amber-600" />
              等待操作
            </dt>
            <dd className="mt-1.5 leading-5 text-muted-foreground">
              打开详情查看提示，Agent 可能需要补充信息或处理确认。
            </dd>
          </div>
          <div>
            <dt className="font-medium">进行中 / 待启动</dt>
            <dd className="mt-1.5 leading-5 text-muted-foreground">
              正在执行，或已保存任务、等待你手动启动。
            </dd>
          </div>
          <div>
            <dt className="font-medium">历史会话</dt>
            <dd className="mt-1.5 leading-5 text-muted-foreground">
              来自本机 CLI 的已有记录，不代表任务已通过验收。
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-2 font-medium">
              <FolderOpen className="size-3" />
              归档记录
            </dt>
            <dd className="mt-1.5 leading-5 text-muted-foreground">
              在任务详情的「任务信息」中归档。之后可从历史记录恢复。
            </dd>
          </div>
        </dl>
      </details>
    </div>
  );
}
