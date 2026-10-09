import { useOrganization, taskMarkKey } from "@/lib/organization";
import { isActive } from "@/lib/types";
import type { ReactElement } from "react";
import { ArrowUpRight, Copy } from "lucide-react";
import type { Task } from "@/lib/types";
import { ContextActions } from "./ContextActions";
import { copyText } from "@/lib/clipboard";

export function TaskContextMenu({
  children,
  task,
  onOpen,
}: {
  children: ReactElement;
  task: Task;
  onOpen: (task: Task) => void;
}) {
  const { marks, mark, archive, busy, ready } = useOrganization();
  const key = taskMarkKey(task);
  return (
    <ContextActions
      actions={[
        {
          label: "打开任务",
          icon: <ArrowUpRight />,
          action: () => onOpen(task),
        },
        {
          label: marks[key]?.pinned ? "取消置顶" : "置顶会话",
          disabled: !ready || busy,
          action: () => void mark(key, { pinned: !marks[key]?.pinned }),
        },
        {
          label: task.archived ? "恢复会话" : "归档会话",
          disabled:
            busy ||
            isActive(task) ||
            task.deviceOnline === false ||
            task.deviceWritable === false,
          action: () => void archive(task, !task.archived),
        },
        {
          label: "复制任务标题",
          icon: <Copy />,
          separator: true,
          action: () => void copyText(task.title),
        },
        { label: "复制项目路径", action: () => void copyText(task.project) },
      ]}
    >
      {children}
    </ContextActions>
  );
}
