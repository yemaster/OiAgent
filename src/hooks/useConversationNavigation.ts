import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TranscriptItem } from "@/lib/transcript";

const PAGE = 80;
const MAX_ITEMS = PAGE * 2;
export function useConversationNavigation(
  items: TranscriptItem[],
  active: boolean,
  suspendAutoScroll = false,
) {
  const scroll = useRef<HTMLDivElement>(null);
  const bottom = useRef(true);
  const pending = useRef<
    { key: string; offset: number } | { latest: true } | null
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
  const indices = useMemo(
    () => new Map(items.map((item, index) => [item.key, index])),
    [items],
  );
  const find = useCallback(
    (key: string) =>
      Array.from(
        scroll.current?.querySelectorAll<HTMLElement>(
          "[data-conversation-key]",
        ) || [],
      ).find(
        (node) =>
          node.dataset.conversationKey === key &&
          !node.querySelector("[data-conversation-key]"),
      ),
    [],
  );
  const jump = useCallback(
    (key: string) => {
      const index = indices.get(key);
      if (index === undefined) return;
      bottom.current = false;
      setShowLatest(true);
      setCurrentKey(key);
      pending.current = { key, offset: 20 };
      setWindow({
        start: Math.max(0, index - 12),
        end: Math.min(items.length, index + PAGE),
      });
    },
    [items, indices],
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
    } else if (
      (target && "latest" in target) ||
      (bottom.current && !suspendAutoScroll)
    )
      el.scrollTop = el.scrollHeight;
    pending.current = null;
  }, [items, start, end, active, find, window, suspendAutoScroll]);
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
      if (bottom.current && !suspendAutoScroll) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [active, suspendAutoScroll]);
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
    const anchors = nodes.filter(
      (node) => !node.querySelector("[data-conversation-key]"),
    );
    const anchor = anchors.find(
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
      const nextStart = Math.max(0, start - PAGE);
      const nextEnd = Math.min(end, nextStart + MAX_ITEMS);
      // Retain the visible turn while dropping the far end of the window.
      pending.current = {
        key: anchor.dataset.conversationKey!,
        offset: anchor.getBoundingClientRect().top - rect.top,
      };
      setWindow({
        start: nextStart,
        end: nextEnd,
      });
    } else if (nearBottom && end < items.length) {
      const nextEnd = Math.min(items.length, end + PAGE);
      const nextStart = Math.max(start, nextEnd - MAX_ITEMS);
      const retained = anchors.find((node) => {
        const index = indices.get(node.dataset.conversationKey!) ?? -1;
        return (
          index >= nextStart && node.getBoundingClientRect().bottom > rect.top
        );
      });
      if (retained)
        pending.current = {
          key: retained.dataset.conversationKey!,
          offset: retained.getBoundingClientRect().top - rect.top,
        };
      setWindow({
        start: nextStart,
        end: nextEnd,
      });
    } else if (nearBottom && window.start >= 0 && end === items.length) {
      latest();
    } else if (window.start < 0 && !bottom.current) {
      // Freeze the reading window while new messages arrive.
      setWindow({ start, end });
    }
  }
  const visible = useMemo(() => items.slice(start, end), [items, start, end]);
  return {
    scroll,
    items: visible,
    marks,
    currentKey,
    jump,
    latest,
    onScroll,
    showLatest,
    atLatest: end === items.length,
  };
}
