import {
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from "react";
import { ChevronUp, ChevronDown, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  createConversationSearch,
  type ConversationMatch,
} from "@/lib/conversationSearch";
import type { TranscriptItem } from "@/lib/transcript";

export function ConversationFind({
  items,
  focusRequest,
  onMatch,
  onClose,
}: {
  items: TranscriptItem[];
  focusRequest: number;
  onMatch: (match: ConversationMatch | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const search = useMemo(() => createConversationSearch(), []);
  const matches = useMemo(
    () => search(items, deferred),
    [search, items, deferred],
  );
  const [selection, setSelection] = useState<{
    query: string;
    id: string;
  } | null>(null);
  const found =
    selection?.query === deferred
      ? matches.findIndex((m) => m.id === selection.id)
      : -1;
  const index = Math.max(0, found);
  const current = matches[index] ?? null;
  const publish = useEffectEvent(() => onMatch(current));
  useEffect(() => {
    publish();
  }, [current?.id, deferred]);
  const move = (direction: number) => {
    if (!matches.length) return;
    const next = (index + direction + matches.length) % matches.length;
    setSelection({ query: deferred, id: matches[next].id });
  };
  const start = current ? Math.max(0, current.offset - 40) : 0;
  return (
    <div
      role="search"
      aria-label="搜索当前对话"
      className="shrink-0 border-b bg-background px-4 py-2"
    >
      <div className="mx-auto flex max-w-3xl items-center gap-1.5">
        <Input
          key={focusRequest}
          autoFocus
          aria-label="搜索对话内容"
          placeholder="搜索当前对话"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 min-w-0 flex-1"
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              move(e.shiftKey ? -1 : 1);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
        />
        <span
          role="status"
          className="min-w-16 text-center text-xs tabular-nums text-muted-foreground"
        >
          {query.trim()
            ? `${matches.length ? index + 1 : 0} / ${matches.length} 条`
            : ""}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="上一条匹配"
          disabled={!matches.length}
          onClick={() => move(-1)}
        >
          <ChevronUp />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="下一条匹配"
          disabled={!matches.length}
          onClick={() => move(1)}
        >
          <ChevronDown />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="关闭对话搜索"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      {current && (
        <p
          className="mx-auto mt-1 max-w-3xl truncate text-xs text-muted-foreground"
          aria-label="匹配内容"
        >
          {start > 0 && "…"}
          {current.text.slice(start, current.offset)}
          <mark className="rounded-sm bg-accent text-accent-foreground">
            {current.text.slice(
              current.offset,
              current.offset + current.query.length,
            )}
          </mark>
          {current.text.slice(
            current.offset + current.query.length,
            current.offset + current.query.length + 100,
          )}
        </p>
      )}
    </div>
  );
}
