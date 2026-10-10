import {
  createContext,
  useContext,
  useCallback,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { cn } from "@/lib/utils";

const DragState = createContext<{
  active: string | null;
  order: string[];
}>({ active: null, order: [] });

export function TabDrag({
  order,
  scrollContainer,
  onMove,
  preview,
  children,
}: {
  order: string[];
  scrollContainer: RefObject<HTMLDivElement | null>;
  onMove: (active: string, target: string) => void;
  preview: (key: string) => ReactNode;
  children: ReactNode;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [width, setWidth] = useState<number>();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={(args) => {
        const bounds = scrollContainer.current?.getBoundingClientRect();
        const pointer = args.pointerCoordinates;
        if (
          !bounds ||
          !pointer ||
          pointer.x < bounds.left ||
          pointer.x > bounds.right ||
          pointer.y < bounds.top ||
          pointer.y > bounds.bottom
        )
          return [];
        return pointerWithin(args);
      }}
      accessibility={{
        screenReaderInstructions: {
          draggable: "拖动调整标签顺序，也可按 Alt + Shift + 左右方向键移动。",
        },
        announcements: {
          onDragStart: () => "开始移动标签。",
          onDragOver: ({ over }) =>
            over
              ? `移到第 ${order.indexOf(String(over.id)) + 1} 个位置。`
              : undefined,
          onDragEnd: ({ over }) => (over ? "标签已移动。" : "标签位置未改变。"),
          onDragCancel: () => "已取消移动。",
        },
      }}
      onDragStart={({ active }) => {
        setActive(String(active.id));
        setWidth(active.rect.current.initial?.width);
      }}
      onDragEnd={({ active, over }) => {
        if (over) onMove(String(active.id), String(over.id));
        setActive(null);
      }}
      onDragCancel={() => setActive(null)}
    >
      <DragState.Provider value={{ active, order }}>
        {children}
      </DragState.Provider>
      <DragOverlay dropAnimation={null}>
        {active && order.includes(active) && (
          <div
            aria-hidden="true"
            style={{ width }}
            className="flex h-10 cursor-grabbing items-center gap-2 border bg-background px-3 text-xs text-foreground shadow-md"
          >
            {preview(active)}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

type Handle = Pick<
  ComponentProps<"button">,
  "onPointerDown" | "aria-describedby" | "ref"
>;
export function DraggableTab({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: (handle: Handle) => ReactNode;
}) {
  const { active, order } = useContext(DragState);
  const { setNodeRef, setActivatorNodeRef, listeners, attributes, isDragging } =
    useDraggable({ id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id });
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      setDropRef(node);
    },
    [setNodeRef, setDropRef],
  );
  const before = active && order.indexOf(active) > order.indexOf(id);
  return (
    <div
      ref={setRef}
      data-tab-key={id}
      className={cn(
        "relative flex shrink-0",
        isDragging && "opacity-40",
        className,
      )}
    >
      {children({
        ref: setActivatorNodeRef,
        onPointerDown: (event) => listeners?.onPointerDown?.(event),
        "aria-describedby": attributes["aria-describedby"],
      })}
      {isOver && active !== id && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-1 z-20 w-0.5 rounded-full bg-primary",
            before ? "left-0" : "right-0",
          )}
        />
      )}
    </div>
  );
}
