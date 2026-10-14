import { useState } from "react";
import { MessageSquare, RotateCcw, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Choice } from "./shared";
import {
  reviewSources,
  downstreamSteps,
  type WorkflowRun,
} from "@/lib/workflows";
import type { Task } from "@/lib/types";

export function WorkflowReviewActions({
  run,
  index,
  tasks,
  busy,
  onRework,
  onRetry,
  onOpen,
}: {
  run: WorkflowRun;
  index: number;
  tasks: Task[];
  busy: boolean;
  onRework: (sourceId: string) => void;
  onRetry: () => void;
  onOpen: (task: Task) => void;
}) {
  const sources = reviewSources(run, index);
  const [selected, setSelected] = useState("");
  const source = sources.find((step) => step.id === selected) || sources.at(-1);
  const state =
    source &&
    run.steps[run.definition.steps.findIndex((step) => step.id === source.id)];
  const child = state && tasks.find((task) => task.id === state.taskIds.at(-1));
  return (
    <div className="w-full space-y-3">
      {source && (
        <>
          <Choice
            label="返工步骤"
            value={source.id}
            onChange={setSelected}
            options={sources.map((step) => ({
              value: step.id,
              label: step.title,
            }))}
          />
          <p className="text-xs text-muted-foreground">
            返工后重新执行 {downstreamSteps(run.definition, source.id).size - 1}{" "}
            个后续步骤
          </p>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {source && (
          <Button
            disabled={busy || run.status !== "waiting"}
            title={
              run.status !== "waiting"
                ? "请先暂停派发，等待其他节点结束"
                : undefined
            }
            onClick={() => onRework(source.id)}
          >
            <Wrench />
            返工并验收
          </Button>
        )}
        {child && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpen(child)}
          >
            <MessageSquare />
            继续对话
          </Button>
        )}
        <Button
          variant={source ? "ghost" : "default"}
          disabled={busy}
          onClick={onRetry}
        >
          <RotateCcw />
          重新验收
        </Button>
      </div>
    </div>
  );
}
