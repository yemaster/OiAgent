import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function ConversationRail({
  marks,
  currentKey,
  onJump,
}: {
  marks: { key: string; text: string }[];
  currentKey: string;
  onJump: (key: string) => void;
}) {
  if (marks.length < 2) return null;
  // Keep large transcripts from creating thousands of interactive DOM nodes.
  const stride = Math.max(1, Math.ceil((marks.length - 1) / 39));
  const visible = marks.filter(
    (mark, index) =>
      index % stride === 0 ||
      index === marks.length - 1 ||
      mark.key === currentKey,
  );
  return (
    <nav
      aria-label="会话跳转"
      onKeyDown={(event) => {
        const direction =
          event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
        if (!direction && !["Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? marks.length - 1
              : Math.max(
                  0,
                  Math.min(
                    marks.length - 1,
                    marks.findIndex((mark) => mark.key === currentKey) +
                      direction,
                  ),
                );
        onJump(marks[index].key);
      }}
      className="absolute right-2 top-1/2 z-10 flex max-h-[75%] -translate-y-1/2 flex-col overflow-y-auto rounded-md bg-background/90 py-1"
    >
      {visible.map((mark) => (
        <Tooltip key={mark.key}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`跳转：${mark.text.slice(0, 80)}`}
              aria-current={mark.key === currentKey ? "location" : undefined}
              onClick={() => onJump(mark.key)}
              className="group flex h-3 min-h-3 w-6 items-center justify-end px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={cn(
                  "h-0.5 w-2 rounded-full bg-muted-foreground/30 transition-all group-hover:w-4 group-hover:bg-foreground",
                  mark.key === currentKey && "w-4 bg-primary",
                )}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-64">
            <p className="line-clamp-3">{mark.text}</p>
          </TooltipContent>
        </Tooltip>
      ))}
    </nav>
  );
}
