import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useDroppable } from "@dnd-kit/core";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { TaskTabs } from "./TaskTabs";
import { TabDrag, useTabDragState } from "./TabDrag";
import {
  editorGroups,
  type EditorGroup,
  type EditorLayout,
  type EditorNode,
  type SplitSide,
} from "@/lib/editorGroups";
import { usePageTransition } from "@/hooks/usePageTransition";
import { cn } from "@/lib/utils";

type TabsProps = ComponentProps<typeof TaskTabs>;
interface WorkspaceContext {
  groups: EditorGroup[];
  targets: Record<string, HTMLDivElement | null>;
  onSelect: (key: string) => void;
}
const Context = createContext<WorkspaceContext | null>(null);

// A stable portal host preserves React state, editor models and terminal sessions
// when a group moves in the split tree. Only its DOM parent changes.
export function EditorPane({
  tabKey,
  children,
  scroll = false,
}: {
  tabKey: string;
  children: ReactNode;
  scroll?: boolean;
}) {
  const context = useContext(Context)!;
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.className = "contents";
    return element;
  });
  const group = context.groups.find((g) => g.tabs.includes(tabKey));
  const visible = group?.active === tabKey;
  const target = group && context.targets[group.id];
  useLayoutEffect(() => {
    if (target) target.appendChild(host);
    return () => {
      host.remove();
    };
  }, [host, target]);
  return createPortal(
    <div
      hidden={!visible}
      className={cn(
        "h-full min-h-0",
        scroll ? "overflow-y-auto" : "overflow-hidden",
      )}
      onPointerDownCapture={() => context.onSelect(tabKey)}
      onFocusCapture={() => context.onSelect(tabKey)}
    >
      {children}
    </div>,
    host,
  );
}

const dropBounds = {
  left: "left-0 top-0 bottom-0 w-1/4",
  right: "right-0 top-0 bottom-0 w-1/4",
  top: "left-1/4 right-1/4 top-0 h-1/4",
  bottom: "left-1/4 right-1/4 bottom-0 h-1/4",
  center: "inset-1/4",
};
const previewBounds = {
  left: "left-0 inset-y-0 w-1/2",
  right: "right-0 inset-y-0 w-1/2",
  top: "top-0 inset-x-0 h-1/2",
  bottom: "bottom-0 inset-x-0 h-1/2",
  center: "inset-0",
};
function DropZone({
  group,
  side,
}: {
  group: string;
  side: keyof typeof dropBounds;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `drop:${group}:${side}` });
  return (
    <>
      <div
        ref={setNodeRef}
        data-editor-drop={side}
        className={cn("absolute z-30", dropBounds[side])}
      />
      {isOver && (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute z-40 rounded bg-primary/10 ring-1 ring-inset ring-primary/30",
            previewBounds[side],
          )}
        />
      )}
    </>
  );
}

function GroupView({
  group,
  focused,
  tabs,
  onTarget,
  onSelect,
  onMove,
  onMerge,
}: {
  group: EditorGroup;
  focused: boolean;
  tabs: TabsProps;
  onTarget: (id: string, node: HTMLDivElement | null) => void;
  onSelect: (key: string) => void;
  onMove: (
    key: string,
    group: string,
    side?: SplitSide,
    before?: string,
  ) => void;
  onMerge?: () => void;
}) {
  const target = useCallback(
    (node: HTMLDivElement | null) => onTarget(group.id, node),
    [group.id, onTarget],
  );
  const transition = usePageTransition(group.active);
  const { active } = useTabDragState();
  const { setNodeRef: headerDrop } = useDroppable({
    id: `drop:${group.id}:header`,
  });
  const canSplit =
    active && (!group.tabs.includes(active) || group.tabs.length > 1);
  return (
    <section
      data-editor-group={group.id}
      aria-label="编辑器分栏"
      className="relative flex h-full min-h-0 min-w-0 flex-col bg-background"
    >
      <div
        ref={headerDrop}
        data-editor-header
        className={cn(
          "shrink-0",
          onMerge && "border-t",
          focused ? "border-border/60" : "border-transparent",
        )}
      >
        <TaskTabs
          {...tabs}
          pageTab={group.tabs.includes("page") ? tabs.pageTab : undefined}
          tasks={tabs.tasks.filter((t) => group.tabs.includes(`task:${t.id}`))}
          files={tabs.files?.filter((t) => group.tabs.includes(`file:${t.id}`))}
          views={tabs.views?.filter((t) =>
            group.tabs.includes(`extension:${t.id}`),
          )}
          selected={
            group.active.startsWith("task:") ? group.active.slice(5) : null
          }
          selectedFile={
            group.active.startsWith("file:") ? group.active.slice(5) : null
          }
          selectedView={
            group.active.startsWith("extension:")
              ? group.active.slice(10)
              : null
          }
          onSelect={(id) => onSelect(`task:${id}`)}
          onSelectFile={(id) => onSelect(`file:${id}`)}
          onSelectView={(id) => onSelect(`extension:${id}`)}
          group={{
            order: group.tabs,
            onMove: (key, before) => onMove(key, group.id, undefined, before),
            onSplit: (key, side) => onMove(key, group.id, side),
            onMerge,
          }}
        />
      </div>
      <div ref={transition} className="relative min-h-0 flex-1 overflow-hidden">
        <div ref={target} className="h-full min-h-0" />
        {active && (
          <div className="absolute inset-0 z-30">
            {(canSplit
              ? (["left", "right", "top", "bottom", "center"] as const)
              : (["center"] as const)
            ).map((side) => (
              <DropZone key={side} group={group.id} side={side} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function EditorWorkspace({
  layout,
  tabs,
  onSelect,
  onMove,
  onMerge,
  children,
}: {
  layout: EditorLayout;
  tabs: TabsProps;
  children: ReactNode;
  onSelect: (key: string) => void;
  onMove: (
    key: string,
    group: string,
    side?: SplitSide,
    before?: string,
  ) => void;
  onMerge: (group: string) => void;
}) {
  const [targets, setTargets] = useState<Record<string, HTMLDivElement | null>>(
    {},
  );
  const onTarget = useCallback((id: string, node: HTMLDivElement | null) => {
    setTargets((current) =>
      current[id] === node ? current : { ...current, [id]: node },
    );
  }, []);
  const [sizes, setSizes] = useState<Record<string, Record<string, number>>>(
    {},
  );
  const groups = editorGroups(layout.root);
  function renderNode(node: EditorNode): ReactNode {
    if (node.kind === "group")
      return (
        <GroupView
          key={node.id}
          group={node}
          focused={layout.focused === node.id}
          tabs={tabs}
          onTarget={onTarget}
          onSelect={onSelect}
          onMove={onMove}
          onMerge={groups.length > 1 ? () => onMerge(node.id) : undefined}
        />
      );
    return (
      <ResizablePanelGroup
        key={node.id}
        id={node.id}
        orientation={node.direction}
        defaultLayout={sizes[node.id]}
        onLayoutChanged={(value, meta) => {
          if (meta.isUserInteraction)
            setSizes((current) => ({ ...current, [node.id]: value }));
        }}
      >
        <ResizablePanel id={`${node.id}-first`} minSize="15%" defaultSize="50%">
          {renderNode(node.first)}
        </ResizablePanel>
        <ResizableHandle
          aria-label={
            node.direction === "horizontal" ? "调整分栏宽度" : "调整分栏高度"
          }
          className={node.direction === "horizontal" ? "w-1" : "h-1"}
        />
        <ResizablePanel
          id={`${node.id}-second`}
          minSize="15%"
          defaultSize="50%"
        >
          {renderNode(node.second)}
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  }
  return (
    <Context.Provider value={{ groups, targets, onSelect }}>
      <TabDrag
        workspace
        order={groups.flatMap((g) => g.tabs)}
        onMove={(key, target) => {
          if (target.startsWith("drop:")) {
            const [, id, side] = target.split(":");
            onMove(
              key,
              id,
              side === "center" || side === "header"
                ? undefined
                : (side as SplitSide),
            );
          } else {
            const group = groups.find((g) => g.tabs.includes(target));
            if (group) onMove(key, group.id, undefined, target);
          }
        }}
        preview={(key) =>
          key === "page"
            ? tabs.pageTab?.title
            : tabs.tasks.find((t) => `task:${t.id}` === key)?.title ||
              tabs.files?.find((t) => `file:${t.id}` === key)?.path ||
              tabs.views?.find((t) => `extension:${t.id}` === key)?.title
        }
      >
        <div className="min-h-0 flex-1 overflow-hidden">
          {renderNode(layout.root)}
        </div>
        {children}
      </TabDrag>
    </Context.Provider>
  );
}
