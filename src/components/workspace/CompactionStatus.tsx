import { useContext } from "react";
import { ConversationSearchContext } from "@/lib/conversationSearch";
import { RecordDisclosure } from "./RecordDisclosure";
import { record } from "@/lib/transcript";
import { motion, useReducedMotion } from "motion/react";
import { Check, LoaderCircle, Minimize2, TriangleAlert } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { compactionOutcome } from "@/lib/compaction";
import type { Task, ToolEvent } from "@/lib/types";

export function CompactionStatus({
  tool,
  task,
}: {
  tool: ToolEvent;
  task: Task;
}) {
  const reduced = useReducedMotion();
  const outcome = compactionOutcome(tool);
  const output = record(tool.output);
  const summary = typeof output.summary === "string" ? output.summary : "";
  const search = useContext(ConversationSearchContext);
  const running =
    outcome === "running" &&
    task.status === "running" &&
    task.deviceOnline !== false;
  const label = running
    ? "正在整理上下文"
    : outcome === "completed"
      ? "上下文已压缩"
      : outcome === "failed"
        ? "上下文整理失败"
        : outcome === "interrupted" ||
            ["cancelled", "stopping", "interrupted", "failed"].includes(
              task.status,
            )
          ? "上下文整理已中断"
          : outcome === "running" && task.deviceOnline === false
            ? "上下文整理状态待同步"
            : "上下文整理结束";
  const Icon = running
    ? LoaderCircle
    : outcome === "completed"
      ? Check
      : outcome === "failed"
        ? TriangleAlert
        : Minimize2;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduced ? 0 : 0.16 }}
      role="status"
      className="space-y-2 py-1 text-xs text-muted-foreground"
    >
      {summary ? (
        <RecordDisclosure
          title={
            <span className="inline-flex items-center gap-2">
              <Icon className="size-3.5" />
              {label}
              {typeof output.preTokens === "number"
                ? ` · ${output.preTokens.toLocaleString()} tokens`
                : ""}
            </span>
          }
          expanded={!!search?.path.includes(tool.callId)}
        >
          {() => <p className="whitespace-pre-wrap break-words">{summary}</p>}
        </RecordDisclosure>
      ) : (
        <div className="flex items-center gap-2">
          <Icon
            aria-hidden="true"
            className={`size-3.5 shrink-0 ${running ? "motion-safe:animate-spin" : ""}`}
          />
          <span>{label}</span>
        </div>
      )}
      {running && (
        <Progress indeterminate aria-label="正在整理上下文" className="h-1" />
      )}
    </motion.div>
  );
}
