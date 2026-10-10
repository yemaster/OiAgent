import { useState } from "react";
import { Plus, ArrowUpRight, Copy, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  PageHeading,
  StatusBadge,
  IconButton,
} from "@/components/workspace/shared";
import { call } from "@/lib/api";
import { newWorkflow, type WorkflowDefinition } from "@/lib/workflows";
import { projectName, type Snapshot, type Task } from "@/lib/types";
import type { useWorkflows } from "@/hooks/useWorkflows";
export function WorkflowsPage({
  state,
  snapshot,
  onEdit,
  onOpen,
}: {
  state: ReturnType<typeof useWorkflows>;
  snapshot: Snapshot;
  onEdit: (d: WorkflowDefinition) => void;
  onOpen: (t: Task) => void;
}) {
  const [remove, setRemove] = useState<WorkflowDefinition>();
  const [busy, setBusy] = useState(false);
  const search = state.query.toLocaleLowerCase();
  const definitions = state.definitions.filter((d) =>
    `${d.name} ${d.goal}`.toLocaleLowerCase().includes(search),
  );
  const runs = snapshot.tasks.filter(
    (t) =>
      !t.deviceId &&
      t.source === "workflow" &&
      !t.archived &&
      `${t.title} ${t.project} ${t.preview}`
        .toLocaleLowerCase()
        .includes(search),
  );
  async function deleteDefinition() {
    if (!remove) return;
    setBusy(true);
    try {
      await call("remove_workflow", {
        id: remove.id,
        revision: remove.revision,
      });
      await state.refresh();
      setRemove(undefined);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-5 sm:p-8">
      <PageHeading title="工作流">
        <Button onClick={() => onEdit(newWorkflow(snapshot.agents))}>
          <Plus />
          新建工作流
        </Button>
      </PageHeading>
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={state.section} onValueChange={state.setSection}>
          <TabsList>
            <TabsTrigger value="library">工作流</TabsTrigger>
            <TabsTrigger value="runs">运行记录</TabsTrigger>
          </TabsList>
        </Tabs>
        <Input
          className="ml-auto w-full sm:w-64"
          aria-label="搜索工作流"
          placeholder="搜索名称、目标或项目…"
          value={state.query}
          onChange={(e) => state.setQuery(e.target.value)}
        />
        <IconButton
          label="刷新工作流"
          onClick={() =>
            void state.refresh().catch((e) => toast.error(String(e)))
          }
        >
          <RefreshCw />
        </IconButton>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.section === "library" ? (
        <>
          {!state.loaded && !state.error ? (
            <p className="py-8 text-sm text-muted-foreground">
              正在读取工作流…
            </p>
          ) : definitions.length ? (
            <div className="divide-y rounded-lg border bg-card">
              {definitions.map((d) => (
                <div key={d.id} className="flex items-center gap-3 p-4">
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onEdit(d)}
                  >
                    <div className="truncate text-sm font-medium">{d.name}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {d.steps.length} 个节点 · {d.goal}
                    </div>
                  </button>
                  <IconButton
                    label={`复制工作流：${d.name}`}
                    onClick={() =>
                      onEdit({
                        ...d,
                        id: "",
                        revision: 0,
                        name: `${d.name} 副本`,
                      })
                    }
                  >
                    <Copy />
                  </IconButton>
                  <IconButton
                    label={`删除工作流：${d.name}`}
                    onClick={() => setRemove(d)}
                  >
                    <Trash2 />
                  </IconButton>
                  <Button variant="outline" size="sm" onClick={() => onEdit(d)}>
                    打开
                    <ArrowUpRight />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-6 text-sm text-muted-foreground">
              {state.query
                ? "没有匹配的工作流。"
                : "还没有保存的工作流。新建一个，或从下面的示例开始。"}
            </p>
          )}
          <section className="space-y-3">
            <h2 className="text-sm font-medium">从示例开始</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {(["implement", "audit", "parallel", "branch"] as const).map(
                (preset) => (
                  <Button
                    key={preset}
                    variant="outline"
                    className="h-auto justify-between px-4 py-4"
                    onClick={() => onEdit(newWorkflow(snapshot.agents, preset))}
                  >
                    {preset === "implement"
                      ? "分析 → 确认 → 实现 → 检查"
                      : preset === "audit"
                        ? "审查 → 确认 → 修复 → 检查"
                        : preset === "parallel"
                          ? "并行审查 → 汇总"
                          : "检查 → 条件分支 → 汇总"}
                    <ArrowUpRight />
                  </Button>
                ),
              )}
            </div>
          </section>
        </>
      ) : runs.length ? (
        <div className="divide-y rounded-lg border bg-card">
          {runs.map((task) => (
            <button
              key={task.id}
              className="flex w-full items-center gap-4 p-4 text-left hover:bg-accent"
              onClick={() => onOpen(task)}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{task.title}</div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {projectName(task.project)} · {task.preview}
                </div>
              </div>
              <StatusBadge status={task.status} />
              <ArrowUpRight className="size-4 shrink-0" />
            </button>
          ))}
        </div>
      ) : (
        <p className="py-8 text-sm text-muted-foreground">
          {state.query
            ? "没有匹配的运行记录。"
            : "工作流启动后，运行记录会显示在这里。"}
        </p>
      )}
      <Dialog
        open={!!remove}
        onOpenChange={(open) => {
          if (!open && !busy) setRemove(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除工作流？</DialogTitle>
            <DialogDescription>
              删除“{remove?.name}”。已有运行记录和子任务会保留。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRemove(undefined)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void deleteDefinition()}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
