import { Pin, PinOff, Archive, ArchiveRestore } from "lucide-react";
import { IconButton } from "./shared";
import { TodoColor } from "./TodoColor";
import { todoColors } from "@/lib/todos";
import { cn } from "@/lib/utils";
import {
  useOrganization,
  taskMarkKey,
  type ItemMark,
} from "@/lib/organization";
import { isActive, type Task } from "@/lib/types";
export function MarkIndicator({ mark }: { mark?: ItemMark }) {
  const color = todoColors.find((c) => c.value === mark?.color);
  return (
    <>
      {color && (
        <span
          role="img"
          aria-label={`${color.label}标记`}
          title={`${color.label}标记`}
          className={cn("size-2 shrink-0 rounded-full", color.className)}
        />
      )}
      {mark?.pinned && (
        <Pin
          className="size-3 shrink-0 text-muted-foreground"
          aria-label="已置顶"
        />
      )}
    </>
  );
}
export function WorkspaceItemActions({
  itemKey,
  name,
  task,
}: {
  itemKey: string;
  name: string;
  task?: Task;
}) {
  const { marks, mark, archive, ready, busy } = useOrganization();
  const value = marks[itemKey] || {};
  return (
    <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/item:opacity-100 [@media(hover:hover)]:group-focus-within/item:opacity-100 has-[[data-state=open]]:opacity-100">
      <IconButton
        size="icon-sm"
        label={`${value.pinned ? "取消置顶" : "置顶"}：${name}`}
        disabled={!ready || busy}
        onClick={() => void mark(itemKey, { pinned: !value.pinned })}
      >
        {value.pinned ? <PinOff /> : <Pin />}
      </IconButton>
      <TodoColor
        value={value.color}
        label={`颜色标记：${name}`}
        disabled={!ready || busy}
        onChange={(color) => void mark(itemKey, { color })}
      />
      {task && (
        <IconButton
          size="icon-sm"
          label={`${task.archived ? "恢复会话" : "归档会话"}：${name}`}
          disabled={
            busy ||
            isActive(task) ||
            task.deviceOnline === false ||
            task.deviceWritable === false
          }
          onClick={() => void archive(task, !task.archived)}
        >
          {task.archived ? <ArchiveRestore /> : <Archive />}
        </IconButton>
      )}
    </div>
  );
}
export function TaskActions({ task }: { task: Task }) {
  return (
    <WorkspaceItemActions
      task={task}
      itemKey={taskMarkKey(task)}
      name={task.title}
    />
  );
}
