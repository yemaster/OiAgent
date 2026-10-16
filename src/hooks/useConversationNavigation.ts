import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TranscriptItem } from "@/lib/transcript";

const PAGE = 80;
export function useConversationNavigation(
  items: TranscriptItem[],
  active: boolean,
) {
  const scroll = useRef<HTMLDivElement>(null);
  const bottom = useRef(true);
  const pending = useRef<
    | { key: string; offset: number }
    | { latest: true }
    | { height: number; top: number }
    | null
  >(null);
  const [window, setWindow] = useState<{ start: number; end: number | null }>({
    start: -1,
    end: null,
  });
  const [showLatest, setShowLatest] = useState(false);
  const [currentKey, setCurrentKey] = useState("");
  const start =
    window.start < 0
      ? Math.max(0, items.length - PAGE)
      : Math.min(window.start, items.length);
  const end = Math.min(window.end ?? items.length, items.length);
  const marks = useMemo(
    () =>
      items.flatMap((item, index) =>
        item.kind === "message" &&
        item.message.role === "user" &&
        !item.message.synthetic
          ? [{ key: item.key, index, text: item.message.text }]
          : [],
      ),
    [items],
  );
  const find = useCallback(
    (key: string) =>
      Array.from(
        scroll.current?.querySelectorAll<HTMLElement>(
          "[data-conversation-key]",
        ) || [],
      ).find((node) => node.dataset.conversationKey === key),
    [],
  );
  const jump = useCallback(
    (key: string) => {
      const index = items.findIndex((item) => item.key === key);
      if (index < 0) return;
      bottom.current = false;
      setShowLatest(true);
      setCurrentKey(key);
      pending.current = { key, offset: 20 };
      setWindow({
        start: Math.max(0, index - 12),
        end: index + PAGE >= items.length ? null : index + PAGE,
      });
    },
    [items],
  );
  const latest = useCallback(() => {
    bottom.current = true;
    pending.current = { latest: true };
    setShowLatest(false);
    setWindow({ start: -1, end: null });
  }, []);
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!active || !el) return;
    const target = pending.current;
    if (target && "key" in target) {
      const node = find(target.key);
      if (node)
        el.scrollTop +=
          node.getBoundingClientRect().top -
          el.getBoundingClientRect().top -
          target.offset;
    } else if (target && "height" in target) {
      el.scrollTop = target.top + el.scrollHeight - target.height;
    } else if (bottom.current) el.scrollTop = el.scrollHeight;
    pending.current = null;
  }, [items, start, end, active, find, window]);
  // Streaming text and expanded tool results change height without adding messages.
  useLayoutEffect(() => {
    const el = scroll.current;
    if (
      !active ||
      !el?.firstElementChild ||
      typeof ResizeObserver === "undefined"
    )
      return;
    const observer = new ResizeObserver(() => {
      if (bottom.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [active]);
  function onScroll() {
    const el = scroll.current;
    if (!el || pending.current || !active) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    bottom.current = nearBottom && end === items.length;
    setShowLatest(!bottom.current);
    const rect = el.getBoundingClientRect();
    const nodes = Array.from(
      el.querySelectorAll<HTMLElement>("[data-conversation-key]"),
    );
    const anchor = nodes.find(
      (node) => node.getBoundingClientRect().bottom > rect.top + 1,
    );
    const user = nodes
      .filter(
        (node) =>
          node.dataset.conversationUser === "true" &&
          node.getBoundingClientRect().top < rect.top + el.clientHeight / 2,
      )
      .at(-1);
    if (user) setCurrentKey(user.dataset.conversationKey!);
    if (el.scrollTop < 100 && start > 0 && anchor) {
      bottom.current = false;
      pending.current = { height: el.scrollHeight, top: el.scrollTop };
      setWindow({ start: Math.max(0, start - PAGE), end: window.end });
    } else if (nearBottom && end < items.length) {
      setWindow({ start, end: end + PAGE >= items.length ? null : end + PAGE });
    } else if (window.start < 0 && !bottom.current) {
      // Freeze the reading window while new messages arrive.
      setWindow({ start, end: null });
    }
  }
  return {
    scroll,
    items: items.slice(start, end),
    marks,
    currentKey,
    jump,
    latest,
    onScroll,
    showLatest,
    atLatest: end === items.length,
  };
}
