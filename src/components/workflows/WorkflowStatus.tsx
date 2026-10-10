import {
  Circle,
  CircleCheck,
  CircleX,
  Hand,
  LoaderCircle,
  OctagonAlert,
  SkipForward,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { stepStatuses, type WorkflowRun } from "@/lib/workflows";
import { cn } from "@/lib/utils";

export type StepStatus = WorkflowRun["steps"][number]["status"];
const workflowStatusStyles = {
  pending: {
    icon: Circle,
    badge: "bg-muted text-muted-foreground",
  },
  running: {
    icon: LoaderCircle,
    badge: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  completed: {
    icon: CircleCheck,
    badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  approval: {
    icon: Hand,
    badge: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  },
  failed: {
    icon: OctagonAlert,
    badge: "bg-destructive/10 text-destructive",
  },
  cancelled: {
    icon: CircleX,
    badge: "bg-muted text-muted-foreground",
  },
  skipped: {
    icon: SkipForward,
    badge: "bg-muted text-muted-foreground",
  },
} satisfies Record<StepStatus, unknown>;

export function WorkflowStatus({
  status,
  className,
}: {
  status: StepStatus;
  className?: string;
}) {
  const { icon: Icon, badge } = workflowStatusStyles[status];
  return (
    <Badge
      variant="secondary"
      className={cn("shrink-0 gap-1.5", badge, className)}
    >
      <Icon
        aria-hidden
        className={cn(
          "size-3.5",
          status === "running" && "motion-safe:animate-spin",
        )}
      />
      {stepStatuses[status]}
    </Badge>
  );
}
