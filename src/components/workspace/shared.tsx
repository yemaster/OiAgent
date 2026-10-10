import { agentCatalog } from "@/lib/agents";
import type { ReactNode } from "react";
import {
  Circle,
  CircleCheck,
  CirclePause,
  Clock3,
  LoaderCircle,
  TriangleAlert,
  Archive,
  Terminal,
  Bot,
  Workflow,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { statusLabels, type Status } from "@/lib/types";
export function StatusBadge({
  status,
  terminal = false,
}: {
  status: Status;
  terminal?: boolean;
}) {
  const icons = {
    running: LoaderCircle,
    waiting: CirclePause,
    queued: Clock3,
    completed: CircleCheck,
    failed: TriangleAlert,
    cancelled: Circle,
    interrupted: TriangleAlert,
    imported: Archive,
  };
  const Icon = icons[status];
  return (
    <Badge
      variant="secondary"
      className={cn(
        "gap-1.5 rounded-sm bg-transparent px-0 text-xs font-normal text-muted-foreground",
        status === "running" &&
          "[&_svg]:text-blue-600 dark:[&_svg]:text-blue-400",
        status === "waiting" &&
          "text-amber-800 [&_svg]:text-amber-600 dark:text-amber-300 dark:[&_svg]:text-amber-400",
        status === "completed" &&
          "[&_svg]:text-emerald-600 dark:[&_svg]:text-emerald-400",
        status === "failed" && "text-red-700 dark:text-red-300",
      )}
    >
      <Icon
        className={cn(
          "size-3",
          status === "running" && "motion-safe:animate-spin",
        )}
      />
      {terminal && status === "running" ? "终端运行中" : statusLabels[status]}
    </Badge>
  );
}
export function AgentIcon({
  kind,
  className,
}: {
  kind: string;
  className?: string;
}) {
  const Icon =
    kind === "terminal" || kind === "aider"
      ? Terminal
      : kind === "supervisor"
        ? Workflow
        : Bot;
  return (
    <span
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground",
        className,
      )}
    >
      {agentCatalog[kind]?.icon ? (
        <img
          src={`/agents/${agentCatalog[kind].icon}.svg`}
          alt=""
          aria-hidden="true"
          className={cn(
            "size-4 object-contain",
            ["codex", "opencode", "goose"].includes(kind) && "dark:invert",
          )}
        />
      ) : (
        <Icon className="size-4" />
      )}
    </span>
  );
}
export function Choice({
  value,
  onChange,
  options,
  label,
  className,
  disabled,
}: {
  value: string;
  onChange: (s: string) => void;
  options: { value: string; label: string }[];
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        aria-label={label}
        className={cn("bg-background", className)}
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function IconButton({
  label,
  children,
  tooltipSide = "top",
  ...props
}: React.ComponentProps<typeof Button> & {
  label: string;
  children: ReactNode;
  tooltipSide?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg bg-muted/50 p-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action}
    </div>
  );
}
export function SectionHeading({
  children,
  count,
  action,
}: {
  children: ReactNode;
  count?: number;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        {children}
        {count !== undefined && (
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
            {count}
          </span>
        )}
      </h2>
      {action}
    </div>
  );
}
export function PageHeading({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold">{title}</h1>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
export function RowArrow() {
  return <ChevronRight className="size-4 shrink-0 text-muted-foreground" />;
}
