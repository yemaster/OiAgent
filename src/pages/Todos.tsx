import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  FolderOpen,
  ListTodo,
  MoreHorizontal,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { desktop, pickDirectory } from "@/lib/api";
import { emptyTodo, filterTodos, type Todo } from "@/lib/todos";
import type { useTodos } from "@/hooks/useTodos";
import { projectName } from "@/lib/types";
import { cn } from "@/lib/utils";

type TodoState = ReturnType<typeof useTodos>;
export function TodosPage({
  state,
  completed,
  projects,
  onCreateTask,
}: {
  state: TodoState;
  completed: boolean;
  projects: string[];
  onCreateTask: (todo: Todo) => void;
}) {
  const { list, busy, error, query, project, important, quick, editor } = state;
  const [removing, setRemoving] = useState<Todo | null>(null);
  const [picking, setPicking] = useState(false);
  const [reloadEditor, setReloadEditor] = useState(false);
  const staleEditor =
    !!editor?.input.id && !!list && editor.revision !== list.revision;
  const items = filterTodos(
    list?.items || [],
    completed,
    query,
    project,
    important,
  );
  const paths = [
    ...new Set([
      ...(list?.items.map((t) => t.project).filter(Boolean) || []),
      ...(project !== "all" && project ? [project] : []),
    ]),
  ].sort();
  const count =
    list?.items.filter((t) => Boolean(t.completedAt) === completed).length || 0;
  const locked = busy || !!editor;
  const filtered = !!query.trim() || project !== "all" || important;
  function edit(item?: Todo) {
    if (!list || editor) return;
    state.setEditor({
      input: item
        ? { ...item }
        : {
            ...emptyTodo(),
            title: quick,
            project: project === "all" ? "" : project,
          },
      revision: list.revision,
    });
  }
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
      {!completed && !editor && (
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
            onClick={() => edit()}
          >
            <SlidersHorizontal />
          </IconButton>
          <Button type="submit" disabled={busy || !list || !quick.trim()}>
            <Plus />
            添加
          </Button>
        </form>
      )}
      {editor && (
        <form
          className="space-y-4 rounded-lg border bg-card p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (picking) return;
            if (
              await state.mutate(
                "save_todo",
                { item: editor.input },
                editor.input.id ? editor.revision : list?.revision,
              )
            ) {
              if (!editor.input.id) state.setQuick("");
              state.setEditor(null);
              state.setQuery("");
              state.setProject("all");
              state.setImportant(false);
            }
          }}
        >
          <h2 className="text-sm font-medium">
            {editor.input.id ? "编辑计划" : "添加计划"}
          </h2>
          {staleEditor && (
            <div
              role="status"
              className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-3 text-sm"
            >
              <span className="flex-1">列表已有更新，请重新载入后再编辑。</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setReloadEditor(true)}
              >
                重新载入
              </Button>
            </div>
          )}
          <fieldset disabled={busy || picking} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="todo-title">计划名称</Label>
              <Input
                id="todo-title"
                autoFocus
                maxLength={200}
                value={editor.input.title}
                onChange={(e) =>
                  state.setEditor({
                    ...editor,
                    input: { ...editor.input, title: e.target.value },
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="todo-notes">备注</Label>
              <Textarea
                id="todo-notes"
                className="min-h-28 text-sm leading-6"
                placeholder="补充需求、步骤或验收要求"
                value={editor.input.notes}
                onChange={(e) =>
                  state.setEditor({
                    ...editor,
                    input: { ...editor.input, notes: e.target.value },
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="todo-project">项目目录（可选）</Label>
              <div className="flex gap-2">
                <Input
                  id="todo-project"
                  list="todo-projects"
                  placeholder="未指定"
                  value={editor.input.project}
                  onChange={(e) =>
                    state.setEditor({
                      ...editor,
                      input: { ...editor.input, project: e.target.value },
                    })
                  }
                />
                <datalist id="todo-projects">
                  {[...new Set([...projects, ...paths])].map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
                {desktop && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      setPicking(true);
                      try {
                        const path = await pickDirectory();
                        if (path)
                          state.setEditor((current) =>
                            current
                              ? {
                                  ...current,
                                  input: { ...current.input, project: path },
                                }
                              : current,
                          );
                      } catch (e) {
                        toast.error(String(e));
                      } finally {
                        setPicking(false);
                      }
                    }}
                  >
                    <FolderOpen />
                    浏览
                  </Button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={editor.input.important}
                onClick={() =>
                  state.setEditor({
                    ...editor,
                    input: {
                      ...editor.input,
                      important: !editor.input.important,
                    },
                  })
                }
              >
                <Star
                  className={cn(editor.input.important && "fill-current")}
                />
                重要
              </Button>
              <div className="flex-1" />
              <Button
                type="button"
                variant="outline"
                onClick={() => state.setEditor(null)}
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={!editor.input.title.trim() || staleEditor}
              >
                <Check />
                保存计划
              </Button>
            </div>
          </fieldset>
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
          {items.map((item) => (
            <li
              key={item.id}
              className={cn(
                "flex items-start gap-3 px-4 py-3 transition-colors",
                editor?.input.id === item.id && "bg-accent/50",
              )}
            >
              <Checkbox
                className="mt-2 shrink-0"
                checked={!!item.completedAt}
                disabled={locked}
                aria-label={`${item.completedAt ? "恢复未完成" : "标记完成"}：${item.title}`}
                onCheckedChange={(checked) =>
                  void state.mutate("complete_todo", {
                    id: item.id,
                    completed: checked === true,
                  })
                }
              />
              <button
                type="button"
                disabled={locked}
                className="min-w-0 flex-1 rounded-sm py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`编辑计划：${item.title}`}
                onClick={() => edit(item)}
              >
                <span
                  className={cn(
                    "block break-words text-sm leading-6",
                    item.completedAt && "text-muted-foreground line-through",
                  )}
                >
                  {item.title}
                </span>
                {(item.project || item.completedAt) && (
                  <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    {item.project && (
                      <span
                        className="max-w-full truncate"
                        title={item.project}
                      >
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
                    <DropdownMenuItem onSelect={() => edit(item)}>
                      编辑计划
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
            </li>
          ))}
        </ul>
      )}
      <Dialog open={reloadEditor} onOpenChange={setReloadEditor}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重新载入计划？</DialogTitle>
            <DialogDescription>
              当前未保存的修改将被丢弃。若计划已被删除，将关闭编辑区。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReloadEditor(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                if (editor && list) {
                  const latest = list.items.find(
                    (item) => item.id === editor.input.id,
                  );
                  state.setEditor(
                    editor.input.id
                      ? latest
                        ? { input: { ...latest }, revision: list.revision }
                        : null
                      : { ...editor, revision: list.revision },
                  );
                }
                setReloadEditor(false);
              }}
            >
              重新载入
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
              计划和备注将被删除，已经创建的 Agent 任务不受影响。
            </DialogDescription>
          </DialogHeader>
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
}
