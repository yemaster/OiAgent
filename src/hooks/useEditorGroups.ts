import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  closeEditorTab,
  editorGroups,
  initialEditorLayout,
  mergeEditorGroups,
  moveEditorTab,
  reconcileEditorLayout,
  type SplitSide,
} from "@/lib/editorGroups";

export function useEditorGroups(available: string[], current: string) {
  const signature = JSON.stringify([available, current]);
  const [saved, setSaved] = useState(() => ({
    signature,
    layout: initialEditorLayout(available, current),
  }));
  let layout = saved.layout;
  if (signature !== saved.signature) {
    layout = reconcileEditorLayout(layout, available, current);
    setSaved({ signature, layout });
  }
  const live = useRef({ layout, current });
  useLayoutEffect(() => {
    live.current = { layout, current };
  });
  const groups = editorGroups(layout.root);
  const afterClose = useCallback((key: string) => {
    const { layout, current } = live.current;
    const groups = editorGroups(layout.root);
    if (groups.length === 1 || !groups.some((g) => g.tabs.includes(key)))
      return null;
    const next = closeEditorTab(layout, key);
    const nextKey =
      key === current
        ? editorGroups(next.root).find((g) => g.id === next.focused)?.active ||
          null
        : null;
    live.current = { layout: next, current: nextKey || current };
    setSaved((s) => ({ ...s, layout: next }));
    return nextKey;
  }, []);
  return {
    layout,
    groups,
    afterClose,
    visible: (key: string) => groups.some((g) => g.active === key),
    move: (key: string, target: string, side?: SplitSide, before?: string) =>
      setSaved((s) => ({
        ...s,
        layout: moveEditorTab(s.layout, key, target, side, before),
      })),
    merge: (group: string) =>
      setSaved((s) => ({ ...s, layout: mergeEditorGroups(s.layout, group) })),
  };
}
