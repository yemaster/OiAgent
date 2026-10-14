import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { call } from "@/lib/api";
import type { Task } from "@/lib/types";

type Input = {
  evidence?: {
    sources: {
      stepId: string;
      title: string;
      taskId?: string;
      attempt: number;
      output: string;
      truncated: boolean;
    }[];
  };
  artifacts?: {
    files: {
      path: string;
      content?: string;
      error?: string;
      truncated?: boolean;
    }[];
  };
};
export function WorkflowInput({
  id,
  index,
  attempt,
  tasks,
  onOpen,
}: {
  id: string;
  index: number;
  attempt: number;
  tasks: Task[];
  onOpen: (task: Task) => void;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Input | null>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    void call<Input | null>("workflow_step_input", { id, index, attempt }).then(
      (value) => {
        if (!disposed) setData(value);
      },
      (error) => {
        if (!disposed) setError(String(error));
      },
    );
    return () => {
      disposed = true;
    };
  }, [open, id, index, attempt]);
  return (
    <details
      className="rounded-lg border p-3"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer text-xs text-muted-foreground">
        上游输入
      </summary>
      {open && (
        <div className="mt-3 space-y-3 text-xs">
          {error ? (
            <p role="alert">{error}</p>
          ) : data === undefined ? (
            <p>正在读取…</p>
          ) : !data ? (
            <p>暂无输入记录</p>
          ) : (
            <>
              {data.evidence?.sources.map((source) => {
                const task = tasks.find((task) => task.id === source.taskId);
                return (
                  <details key={source.stepId}>
                    <summary className="cursor-pointer">
                      {source.title}{" "}
                      <span className="text-muted-foreground">
                        · 第 {source.attempt} 次
                      </span>
                    </summary>
                    {task && (
                      <Button
                        size="xs"
                        variant="ghost"
                        className="mt-2"
                        onClick={() => onOpen(task)}
                      >
                        查看任务
                        <ArrowUpRight />
                      </Button>
                    )}
                    <p className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words leading-6">
                      {source.output}
                    </p>
                    {source.truncated && (
                      <p className="text-muted-foreground">内容已截取</p>
                    )}
                  </details>
                );
              })}
              {data.artifacts?.files.map((file) => (
                <details key={file.path}>
                  <summary
                    className="cursor-pointer truncate"
                    title={file.path}
                  >
                    {file.path.split(/[\\/]/).at(-1)}
                  </summary>
                  <p className="mt-2 break-all text-muted-foreground">
                    {file.path}
                  </p>
                  <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words font-sans leading-6">
                    {file.error || file.content}
                  </pre>
                  {file.truncated && (
                    <p className="text-muted-foreground">正文已截取</p>
                  )}
                </details>
              ))}
              {!data.evidence?.sources.length &&
                !data.artifacts?.files.length && (
                  <p className="text-muted-foreground">无上游输入</p>
                )}
            </>
          )}
        </div>
      )}
    </details>
  );
}
