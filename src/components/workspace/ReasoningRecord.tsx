import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ChevronRight, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDocumentVisible } from "@/hooks/useDocumentVisible";
import type { Message } from "@/lib/types";

function duration(start: string | null | undefined, end: number) {
  const since = Date.parse(start || "");
  if (!Number.isFinite(since) || !Number.isFinite(end)) return "";
  const seconds = Math.max(0, Math.floor((end - since) / 1000));
  return seconds < 60
    ? `${seconds} 秒`
    : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

/** Two visual lines at each end, including single-line text that wraps. */
const ThinkingText = memo(function ThinkingText({
  text,
  expanded,
}: {
  text: string;
  expanded: boolean;
}) {
  const [all, setAll] = useState(false);
  const [long, setLong] = useState(false);
  const measure = useRef<HTMLDivElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const element = measure.current;
    if (element) setLong(element.scrollHeight > 4 * 24 + 1);
  }, [text]);
  useLayoutEffect(() => {
    const element = measure.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setLong(element.scrollHeight > 4 * 24 + 1));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const full = expanded || all || !long;
  return (
    <div className="relative min-w-0 text-sm leading-6 text-muted-foreground/85">
      <div id={id}>
        <div
          ref={measure}
          className={`whitespace-pre-wrap break-words ${!full ? "line-clamp-2 [mask-image:linear-gradient(to_bottom,black_calc(100%_-_12px),transparent)]" : ""}`}
        >
          {text}
        </div>
        {!full && (
          <>
            <button
              type="button"
              onClick={() => setAll(true)}
              aria-expanded={false}
              aria-controls={id}
              className="my-1 rounded px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              展开全部思考
            </button>
            <div
              aria-hidden="true"
              className="flex h-12 flex-col justify-end overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_12px)]"
            >
              <div className="shrink-0 whitespace-pre-wrap break-words">
                {text}
              </div>
            </div>
          </>
        )}
      </div>
      {long && all && !expanded && (
        <button
          type="button"
          onClick={() => setAll(false)}
          aria-expanded={true}
          aria-controls={id}
          className="mt-1 rounded px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          收起中间内容
        </button>
      )}
    </div>
  );
});

export const ReasoningRecord = memo(function ReasoningRecord({
  message,
  active,
  selected,
  anchorKey,
  stoppedAt,
  visible = true,
}: {
  message: Message;
  active: boolean;
  selected?: boolean;
  anchorKey?: string;
  stoppedAt: string;
  visible?: boolean;
}) {
  const documentVisible = useDocumentVisible();
  const [now, setNow] = useState(() => Date.now());
  // A different lifecycle gets its own disclosure state, so finishing always closes it.
  const [manual, setManual] = useState<{ active: boolean; open: boolean }>();
  const open = selected || (manual?.active === active ? manual.open : active);
  const id = useId();
  useEffect(() => {
    if (!active || !visible || !documentVisible) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, visible, documentVisible]);
  const elapsed = duration(
    message.reasoning?.startedAt ||
      (message.delta ? message.timestamp : undefined),
    active ? now : Date.parse(message.reasoning?.completedAt || stoppedAt),
  );
  const label = active
    ? `正在思考${elapsed ? ` · ${elapsed}` : ""}`
    : elapsed
      ? `思考了 ${elapsed}`
      : "思考记录";
  return (
    <div
      data-conversation-key={anchorKey}
      data-search-match={selected || undefined}
      className="min-w-0 text-muted-foreground"
    >
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={!!open}
        aria-controls={id}
        onClick={() => setManual({ active, open: !open })}
        className="h-auto max-w-full justify-start gap-2 px-1 py-2 text-xs font-normal"
      >
        {active ? (
          <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
        ) : (
          <ChevronRight
            className={`size-3.5 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
          />
        )}
        {label}
      </Button>
      {open && (
        <div id={id} className="ml-2 border-l border-border pl-4 py-1">
          <ThinkingText
            key={String(active)}
            text={message.text}
            expanded={!!selected}
          />
        </div>
      )}
    </div>
  );
});
