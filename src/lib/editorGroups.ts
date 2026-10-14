import { moveTab } from "@/hooks/useTabOrder";

export type SplitSide = "left" | "right" | "top" | "bottom";
export interface EditorGroup {
  kind: "group";
  id: string;
  tabs: string[];
  active: string;
  history: string[];
}
export type EditorNode =
  | EditorGroup
  | {
      kind: "split";
      id: string;
      direction: "horizontal" | "vertical";
      first: EditorNode;
      second: EditorNode;
    };
export interface EditorLayout {
  root: EditorNode;
  focused: string;
  serial: number;
}
export function editorGroups(node: EditorNode): EditorGroup[] {
  return node.kind === "group"
    ? [node]
    : [...editorGroups(node.first), ...editorGroups(node.second)];
}
function mapGroups(
  node: EditorNode,
  update: (group: EditorGroup) => EditorGroup,
): EditorNode {
  return node.kind === "group"
    ? update(node)
    : {
        ...node,
        first: mapGroups(node.first, update),
        second: mapGroups(node.second, update),
      };
}
function collapse(node: EditorNode): EditorNode | null {
  if (node.kind === "group") return node.tabs.length ? node : null;
  const first = collapse(node.first),
    second = collapse(node.second);
  return first && second ? { ...node, first, second } : first || second;
}
function select(group: EditorGroup, key: string): EditorGroup {
  return {
    ...group,
    active: key,
    history: [key, ...group.history.filter((t) => t !== key)],
  };
}
function remove(group: EditorGroup, key: string): EditorGroup {
  const tabs = group.tabs.filter((t) => t !== key);
  const history = group.history.filter((t) => t !== key && tabs.includes(t));
  return {
    ...group,
    tabs,
    history,
    active: group.active === key ? history[0] || tabs[0] || "" : group.active,
  };
}
export function initialEditorLayout(
  tabs: string[],
  current: string,
): EditorLayout {
  return {
    root: {
      kind: "group",
      id: "group-0",
      tabs,
      active: current,
      history: [current],
    },
    focused: "group-0",
    serial: 1,
  };
}
export function reconcileEditorLayout(
  layout: EditorLayout,
  available: string[],
  current: string,
): EditorLayout {
  const valid = new Set(available);
  let root = mapGroups(layout.root, (group) => {
    let next = group;
    for (const tab of group.tabs) if (!valid.has(tab)) next = remove(next, tab);
    return next;
  });
  const groups = editorGroups(root);
  const known = new Set(groups.flatMap((g) => g.tabs));
  const newTabs = available.filter((key) => !known.has(key));
  const target = groups.find((g) => g.id === layout.focused) || groups[0];
  root = mapGroups(root, (g) =>
    g.id === target.id ? { ...g, tabs: [...g.tabs, ...newTabs] } : g,
  );
  root = collapse(root) || initialEditorLayout(available, current).root;
  const owner = editorGroups(root).find((g) => g.tabs.includes(current));
  return {
    ...layout,
    root: owner
      ? mapGroups(root, (g) => (g.id === owner.id ? select(g, current) : g))
      : root,
    focused: owner?.id || editorGroups(root)[0].id,
  };
}
export function moveEditorTab(
  layout: EditorLayout,
  key: string,
  targetId: string,
  side?: SplitSide,
  before?: string,
): EditorLayout {
  const groups = editorGroups(layout.root);
  const source = groups.find((g) => g.tabs.includes(key));
  const target = groups.find((g) => g.id === targetId);
  if (!source || !target) return layout;
  if (!side && source.id === target.id) {
    return {
      ...layout,
      root: mapGroups(layout.root, (g) =>
        g.id === source.id
          ? { ...g, tabs: moveTab(g.tabs, key, before || g.tabs.at(-1)!) }
          : g,
      ),
    };
  }
  if (side && source.id === target.id && source.tabs.length < 2) return layout;
  let root = mapGroups(layout.root, (g) =>
    g.id === source.id ? remove(g, key) : g,
  );
  let focused = target.id;
  if (side) {
    focused = `group-${layout.serial}`;
    const newGroup: EditorGroup = {
      kind: "group",
      id: focused,
      tabs: [key],
      active: key,
      history: [key],
    };
    function split(node: EditorNode): EditorNode {
      if (node.kind === "split")
        return {
          ...node,
          first: split(node.first),
          second: split(node.second),
        };
      if (node.id !== targetId) return node;
      const leading = side === "left" || side === "top";
      return {
        kind: "split",
        id: `split-${layout.serial}`,
        direction:
          side === "left" || side === "right" ? "horizontal" : "vertical",
        first: leading ? newGroup : node,
        second: leading ? node : newGroup,
      };
    }
    root = split(root);
  } else {
    root = mapGroups(root, (g) => {
      if (g.id !== targetId) return g;
      const tabs = [...g.tabs];
      const index = before ? tabs.indexOf(before) : -1;
      tabs.splice(index < 0 ? tabs.length : index, 0, key);
      return select({ ...g, tabs }, key);
    });
  }
  return {
    root: collapse(root)!,
    focused,
    serial: layout.serial + (side ? 1 : 0),
  };
}
export function closeEditorTab(
  layout: EditorLayout,
  key: string,
): EditorLayout {
  const root = collapse(mapGroups(layout.root, (g) => remove(g, key)))!;
  const groups = editorGroups(root);
  return {
    ...layout,
    root,
    focused: groups.some((g) => g.id === layout.focused)
      ? layout.focused
      : groups[0].id,
  };
}
export function mergeEditorGroups(
  layout: EditorLayout,
  targetId: string,
): EditorLayout {
  const groups = editorGroups(layout.root);
  const target = groups.find((g) => g.id === targetId) || groups[0];
  return {
    ...layout,
    root: {
      ...target,
      tabs: [
        ...target.tabs,
        ...groups.filter((g) => g !== target).flatMap((g) => g.tabs),
      ],
    },
    focused: target.id,
  };
}
