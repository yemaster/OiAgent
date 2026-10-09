import { TodoColor } from "@/components/workspace/TodoColor";
import { useMemo, useState } from "react";
import { ArrowLeft, Check, FolderOpen, RefreshCw, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Choice, IconButton } from "@/components/workspace/shared";
import { desktop, pickDirectory } from "@/lib/api";
import {
  localDate,
  todoParentOptions,
  todoPath,
  type TodoEditor,
} from "@/lib/todos";
import type { useTodos } from "@/hooks/useTodos";
import { cn } from "@/lib/utils";

export function TodoEditorPage({
  state,
  projects,
  onBack,
  onDone,
}: {
  state: ReturnType<typeof useTodos>;
  projects: string[];
  onBack: () => void;
  onDone: (editor: TodoEditor) => void;
}) {
  const { list, editor, busy, error } = state;
  const [picking, setPicking] = useState(false);
  const [reloadEditor, setReloadEditor] = useState(false);
  const parentOptions = useMemo(
    () =>
      todoParentOptions(list?.items || [], editor?.input.id || "").map(
        (item) => ({
          value: item.id,
          label: todoPath(list?.items || [], item),
        }),
      ),
    [list, editor?.input.id],
  );
  if (!editor) return null;
  const staleEditor =
    !!editor.input.id && !!list && editor.revision !== list.revision;
  const parent = list?.items.find((item) => item.id === editor.input.parentId);
  const paths = list?.items.map((item) => item.project).filter(Boolean) || [];
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6 lg:p-8">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft />
        返回计划列表
      </Button>
      <header className="flex items-center gap-3">
        <h1 className="flex-1 text-xl font-semibold">
          {editor.input.id
            ? "编辑计划"
            : editor.input.parentId
              ? "添加子计划"
              : "添加计划"}
        </h1>
        <IconButton
          label="刷新计划"
          disabled={busy}
          onClick={() => void state.refresh()}
        >
          <RefreshCw className={cn(busy && "motion-safe:animate-spin")} />
        </IconButton>
      </header>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <form
        className="space-y-6"
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
            onDone(editor);
          }
        }}
      >
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
          <div className="flex items-center gap-3">
            <Label>颜色标记</Label>
            <TodoColor
              value={editor.input.color}
              onChange={(color) =>
                state.setEditor({
                  ...editor,
                  input: { ...editor.input, color },
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
            <Label htmlFor="todo-due">截止日期（可选）</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="todo-due"
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                className="w-auto min-w-44"
                value={editor.input.dueDate || ""}
                onChange={(e) =>
                  state.setEditor({
                    ...editor,
                    input: { ...editor.input, dueDate: e.target.value || null },
                  })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  state.setEditor({
                    ...editor,
                    input: { ...editor.input, dueDate: localDate() },
                  })
                }
              >
                今天
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  state.setEditor({
                    ...editor,
                    input: {
                      ...editor.input,
                      dueDate: localDate(new Date(), 1),
                    },
                  })
                }
              >
                明天
              </Button>
              {editor.input.dueDate && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    state.setEditor({
                      ...editor,
                      input: { ...editor.input, dueDate: null },
                    })
                  }
                >
                  清除日期
                </Button>
              )}
            </div>
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
                          current?.sessionId === editor.sessionId
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
          <div className="space-y-2">
            <Label>父计划</Label>
            <Choice
              label="父计划"
              value={editor.input.parentId || "none"}
              onChange={(value) =>
                state.setEditor({
                  ...editor,
                  input: {
                    ...editor.input,
                    parentId: value === "none" ? null : value,
                  },
                })
              }
              options={[
                { value: "none", label: "无（独立计划）" },
                ...parentOptions,
              ]}
              className="w-full"
            />
            {editor.input.parentId && !parent && (
              <p className="text-xs text-destructive">
                父计划已删除，请重新选择。
              </p>
            )}
            {parent?.completedAt && (
              <p className="text-xs text-muted-foreground">
                添加或移入未完成的子计划后，父计划会恢复为未完成。
              </p>
            )}
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
              <Star className={cn(editor.input.important && "fill-current")} />
              重要
            </Button>
            <div className="flex-1" />
            <Button
              type="button"
              variant="outline"
              onClick={() => onDone(editor)}
            >
              放弃修改
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
      <Dialog open={reloadEditor} onOpenChange={setReloadEditor}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重新载入计划？</DialogTitle>
            <DialogDescription>
              当前未保存的修改将被丢弃。若计划已被删除，将返回列表。
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
                  if (editor.input.id && !latest) onDone(editor);
                  else
                    state.setEditor({
                      ...editor,
                      input: latest ? { ...latest } : editor.input,
                      base: latest ? { ...latest } : null,
                      revision: list.revision,
                    });
                }
                setReloadEditor(false);
              }}
            >
              重新载入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
