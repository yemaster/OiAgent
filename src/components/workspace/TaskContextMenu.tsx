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
  return (
    <ContextActions
      actions={[
        {
          label: "打开任务",
          icon: <ArrowUpRight />,
          action: () => onOpen(task),
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
