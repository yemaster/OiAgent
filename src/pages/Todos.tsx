import { useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  ListTodo,
  ChevronRight,
  MoreHorizontal,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Star,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Choice, IconButton } from "@/components/workspace/shared";
import {
  emptyTodo,
  deadlineLabel,
  filterTodos,
  todoDescendants,
  todoDepths,
  todoTree,
  type Todo,
  type TodoNode,
} from "@/lib/todos";
import { useLocalDate } from "@/hooks/useLocalDate";
import type { useTodos } from "@/hooks/useTodos";
import { projectName } from "@/lib/types";
import { cn } from "@/lib/utils";

type TodoState = ReturnType<typeof useTodos>;
export function TodosPage({
  state,
  completed,
  onEdit,
  onCreateTask,
}: {
  state: TodoState;
  completed: boolean;
  onEdit: (item?: Todo, parent?: Todo) => void;
  onCreateTask: (todo: Todo) => void;
}) {
  const { list, busy, error, query, project, important, quick } = state;
  const today = useLocalDate();
  const [removing, setRemoving] = useState<Todo | null>(null);
  const [completing, setCompleting] = useState<Todo | null>(null);
  const items = filterTodos(
    list?.items || [],
    completed,
    query,
    project,
    important,
  );
  const depths = todoDepths(list?.items || []);
  const tree = todoTree(list?.items || [], items);
  const paths = [
    ...new Set([
      ...(list?.items.map((t) => t.project).filter(Boolean) || []),
      ...(project !== "all" && project ? [project] : []),
    ]),
  ].sort();
  const count =
    list?.items.filter((t) => Boolean(t.completedAt) === completed).length || 0;
  const locked = busy;
  const filtered = !!query.trim() || project !== "all" || important;
  async function addQuick() {
    if (!quick.trim()) return;
    if (
      await state.mutate("save_todo", {
        item: {
          ...emptyTodo(),
          title: quick,
          project: project === "all" ? "" : project,
        },
      })
    ) {
      state.setQuick("");
      state.setQuery("");
      state.setImportant(false);
    }
  }
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6 lg:p-8">
      <header className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">
          {completed ? "已完成" : "未完成"}
        </h1>
        {list && (
          <span className="text-sm tabular-nums text-muted-foreground">
            {count}
          </span>
        )}
        <IconButton
          label="刷新计划"
          className="ml-auto"
          disabled={busy}
          onClick={() => void state.refresh()}
        >
          <RefreshCw className={cn(busy && "motion-safe:animate-spin")} />
        </IconButton>
      </header>
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      {!completed && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void addQuick();
          }}
        >
          <Input
            aria-label="新计划名称"
            placeholder="添加一个计划…"
            maxLength={200}
            value={quick}
            onChange={(e) => state.setQuick(e.target.value)}
            disabled={busy || !list}
          />
          <IconButton
            type="button"
            label="添加详情"
            disabled={busy || !list}
            onClick={() => onEdit()}
          >
            <SlidersHorizontal />
          </IconButton>
          <Button type="submit" disabled={busy || !list || !quick.trim()}>
            <Plus />
            添加
          </Button>
        </form>
      )}
      {(!!list?.items.length || filtered) && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="搜索计划"
            placeholder="搜索计划…"
            className="min-w-40 flex-1"
            value={query}
            onChange={(e) => state.setQuery(e.target.value)}
          />
          <Choice
            label="按项目筛选计划"
            value={project || "none"}
            onChange={(v) => state.setProject(v === "none" ? "" : v)}
            options={[
              { value: "all", label: "全部项目" },
              { value: "none", label: "未指定项目" },
              ...paths.map((p) => ({
                value: p,
                label: projectName(p) + " · " + p,
              })),
            ]}
            className="max-w-64"
          />
          <Button
            variant={important ? "secondary" : "ghost"}
            aria-pressed={important}
            onClick={() => state.setImportant(!important)}
          >
            <Star className={cn(important && "fill-current")} />
            重要
          </Button>
        </div>
      )}
      {!list ? (
        <p
          role="status"
          className="py-12 text-center text-sm text-muted-foreground"
        >
          {error ? "无法读取计划，请刷新重试。" : "正在读取计划…"}
        </p>
      ) : !items.length ? (
        <div className="space-y-3 py-14 text-center">
          <ListTodo className="mx-auto size-7 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {filtered
              ? "没有匹配的计划"
              : completed
                ? "还没有已完成的计划"
                : "没有未完成的计划"}
          </p>
          {filtered ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                state.setQuery("");
                state.setProject("all");
                state.setImportant(false);
              }}
            >
              清除筛选
            </Button>
          ) : (
            !completed && (
              <p className="text-xs text-muted-foreground">
                在上方输入计划，按 Enter 添加。
              </p>
            )
          )}
        </div>
      ) : (
        <ul
          aria-label="计划列表"
          className="divide-y rounded-lg border bg-card"
        >
          {tree.map(renderNode)}
        </ul>
      )}
      <Dialog
        open={!!completing}
        onOpenChange={(open) => {
          if (!open && !busy) setCompleting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>完成「{completing?.title}」及其子计划？</DialogTitle>
            <DialogDescription>
              所有未完成的子计划也会标记完成。
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setCompleting(null)}
            >
              取消
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (
                  completing &&
                  (await state.mutate("complete_todo", {
                    id: completing.id,
                    completed: true,
                  }))
                )
                  setCompleting(null);
              }}
            >
              全部完成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoving(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除「{removing?.title}」？</DialogTitle>
            <DialogDescription>
              仅删除此计划和备注。子计划会保留并上移一级，已经创建的 Agent
              任务不受影响。
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRemoving(null)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (
                  removing &&
                  (await state.mutate("remove_todo", { id: removing.id }))
                )
                  setRemoving(null);
              }}
            >
              删除计划
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
  function renderNode(node: TodoNode) {
    const { item, children, context } = node;
    const expanded = filtered || context || !state.collapsed.has(item.id);
    const allChildren =
      list?.items.filter((child) => child.parentId === item.id) || [];
    return (
      <li key={item.id}>
        <div className="flex items-start gap-2 px-3 py-3 transition-colors">
          {children.length ? (
            <IconButton
              size="icon-sm"
              className="shrink-0"
              label={`${expanded ? "收起" : "展开"}子计划：${item.title}`}
              aria-expanded={expanded}
              disabled={filtered || context}
              onClick={() =>
                state.setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(item.id)) next.delete(item.id);
                  else next.add(item.id);
                  return next;
                })
              }
            >
              <ChevronRight
                className={cn(
                  "size-4 transition-transform",
                  expanded && "rotate-90",
                )}
              />
            </IconButton>
          ) : (
            <span className="w-8 shrink-0" />
          )}
          <Checkbox
            className="mt-2 shrink-0"
            checked={!!item.completedAt}
            disabled={locked || context}
            aria-label={`${item.completedAt ? "恢复未完成" : "标记完成"}：${item.title}`}
            onCheckedChange={(checked) => {
              const descendants = todoDescendants(list?.items || [], item.id);
              if (
                checked === true &&
                list?.items.some(
                  (child) =>
                    child.id !== item.id &&
                    descendants.has(child.id) &&
                    !child.completedAt,
                )
              )
                setCompleting(item);
              else
                void state.mutate("complete_todo", {
                  id: item.id,
                  completed: checked === true,
                });
            }}
          />
          <button
            type="button"
            disabled={locked}
            className="min-w-0 flex-1 rounded-sm py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`编辑计划：${item.title}`}
            onClick={() => onEdit(item)}
          >
            <span
              className={cn(
                "block break-words text-sm leading-6",
                item.completedAt && "text-muted-foreground line-through",
              )}
            >
              {item.title}
            </span>
            {allChildren.length > 0 && (
              <span className="block text-xs text-muted-foreground">
                {allChildren.filter((child) => child.completedAt).length}/
                {allChildren.length} 子计划
              </span>
            )}
            {context && (
              <span className="block text-xs text-muted-foreground">
                父计划
              </span>
            )}
            {(item.project || item.completedAt || item.dueDate) && (
              <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                {item.dueDate && (
                  <time
                    dateTime={item.dueDate}
                    className={cn(
                      "inline-flex items-center gap-1",
                      !item.completedAt &&
                        item.dueDate < today &&
                        "text-destructive",
                      !item.completedAt &&
                        item.dueDate === today &&
                        "text-amber-700 dark:text-amber-400",
                    )}
                  >
                    <CalendarDays className="size-3" />
                    {deadlineLabel(item, today)}
                  </time>
                )}
                {item.project && (
                  <span className="max-w-full truncate" title={item.project}>
                    {projectName(item.project)}
                  </span>
                )}
                {item.completedAt && (
                  <time dateTime={item.completedAt}>
                    {new Date(item.completedAt).toLocaleDateString()} 完成
                  </time>
                )}
              </span>
            )}
          </button>
          {!context && (
            <div className="flex shrink-0 flex-wrap items-center gap-1 pt-0.5">
              <IconButton
                label={`${item.important ? "取消重要标记" : "标为重要"}：${item.title}`}
                size="icon-sm"
                aria-pressed={item.important}
                disabled={locked}
                onClick={() =>
                  void state.mutate("save_todo", {
                    item: { ...item, important: !item.important },
                  })
                }
              >
                <Star
                  className={cn(
                    "size-4",
                    item.important ? "fill-current" : "text-muted-foreground",
                  )}
                />
              </IconButton>
              {!item.completedAt && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={locked}
                  onClick={() => onCreateTask(item)}
                >
                  <ArrowUpRight />
                  创建任务
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`更多操作：${item.title}`}
                    disabled={locked}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onEdit(item)}>
                    编辑计划
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={(depths.get(item.id) || 0) >= 5}
                    onSelect={() => onEdit(undefined, item)}
                  >
                    <Plus />
                    添加子计划
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setRemoving(item)}
                  >
                    <Trash2 />
                    删除计划
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
        {children.length > 0 && expanded && (
          <ul
            aria-label={`${item.title}的子计划`}
            className="ml-4 divide-y border-l sm:ml-7"
          >
            {children.map(renderNode)}
          </ul>
        )}
      </li>
    );
  }
}
