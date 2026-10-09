import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
  closestCenter,
  type DragOverEvent,
} from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { moveTodo, type Todo } from "@/lib/todos";
import { cn } from "@/lib/utils";
type Drop = { targetId: string | null; placement: string };
const DragState = createContext<{
  active: string | null;
  over: Drop | null;
  error: string;
  disabled: boolean;
}>({ active: null, over: null, error: "", disabled: true });
export function TodoDrag({
  items,
  revision,
  disabled,
  onMove,
  children,
}: {
  items: Todo[];
  revision: string;
  disabled: boolean;
  onMove: (id: string, target: Drop, revision: string) => void;
  children: ReactNode;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [over, setOver] = useState<Drop | null>(null);
  const [error, setError] = useState("");
  const base = useRef(revision);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  function preview(event: DragOverEvent) {
    const target = event.over?.data.current as Drop | undefined;
    setOver(target || null);
    try {
      if (target)
        moveTodo(
          items,
          String(event.active.id),
          target.targetId,
          target.placement,
          "",
        );
      setError("");
    } catch (error) {
      setError(String(error).replace(/^Error: /, ""));
    }
  }
  const target = items.find((t) => t.id === over?.targetId);
  const hint =
    error ||
    (over
      ? over.placement === "root"
        ? "移为独立计划"
        : over.placement === "inside"
          ? `成为「${target?.title}」的子计划`
          : `移到「${target?.title}」${over.placement === "before" ? "前面" : "后面"}，保持同级`
      : "拖到计划中间设为子计划，上下边缘调整顺序");
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={(args) =>
        args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)
      }
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "按空格开始移动，方向键选择位置，再按空格放下，Escape 取消。",
        },
        announcements: {
          onDragStart: () => "开始移动计划。",
          onDragOver: () => hint,
          onDragEnd: () => "移动结束。",
          onDragCancel: () => "已取消移动。",
        },
      }}
      onDragStart={(event) => {
        base.current = revision;
        setActive(String(event.active.id));
        setOver(null);
        setError("");
      }}
      onDragOver={preview}
      onDragEnd={(event) => {
        const target = event.over?.data.current as Drop | undefined;
        if (target && !disabled) {
          try {
            moveTodo(
              items,
              String(event.active.id),
              target.targetId,
              target.placement,
              "",
            );
            onMove(String(event.active.id), target, base.current);
          } catch {
            /* The invalid drop is already explained in the preview. */
          }
        }
        setActive(null);
        setOver(null);
        setError("");
      }}
      onDragCancel={() => {
        setActive(null);
        setOver(null);
        setError("");
      }}
    >
      <DragState.Provider value={{ active, over, error, disabled }}>
        {children}
        {active && <RootDrop />}
        <div
          aria-live="polite"
          role="status"
          className={cn(
            "text-xs",
            error ? "text-destructive" : "text-muted-foreground",
            !active && "sr-only",
          )}
        >
          {active ? hint : ""}
        </div>
        <DragOverlay dropAnimation={null}>
          {active && (
            <div className="max-w-sm truncate rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
              {items.find((t) => t.id === active)?.title}
            </div>
          )}
        </DragOverlay>
      </DragState.Provider>
    </DndContext>
  );
}
function DropZone({
  targetId,
  placement,
  className,
}: Drop & { className: string }) {
  const { disabled, active } = useContext(DragState);
  const { setNodeRef } = useDroppable({
    id: `${placement}:${targetId || "root"}`,
    data: { targetId, placement },
    disabled: disabled || active === targetId,
  });
  return (
    <span
      ref={setNodeRef}
      data-todo-drop={placement}
      data-todo-target={targetId}
      className={cn("pointer-events-none absolute inset-x-0", className)}
    />
  );
}
function RootDrop() {
  const { over } = useContext(DragState);
  const { setNodeRef } = useDroppable({
    id: "root-drop",
    data: { targetId: null, placement: "root" },
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "mt-2 rounded-md border border-dashed p-4 text-center text-sm",
        over?.placement === "root"
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground",
      )}
    >
      移为独立计划
    </div>
  );
}
export function TodoDragRow({
  item,
  children,
  context,
}: {
  item: Todo;
  children: ReactNode;
  context: boolean;
}) {
  const { disabled, over, error } = useContext(DragState);
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } =
    useDraggable({ id: item.id, disabled: disabled || context });
  const hovered = over?.targetId === item.id;
  return (
    <div
      ref={setNodeRef}
      data-todo-row={item.id}
      className={cn(
        "relative flex items-start gap-2 px-3 py-3 transition-colors",
        isDragging && "opacity-40",
        hovered && over?.placement === "inside" && "bg-accent",
        hovered && error && "bg-destructive/10",
      )}
    >
      <Button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        type="button"
        variant="ghost"
        size="icon-sm"
        className="touch-none shrink-0 cursor-grab active:cursor-grabbing"
        disabled={disabled || context}
        aria-label={`移动计划：${item.title}`}
        title={
          disabled
            ? "清除筛选并选择手动排序后可拖动"
            : "拖动调整顺序或设为子计划"
        }
      >
        <GripVertical className="size-4 text-muted-foreground" />
      </Button>
      {children}
      <DropZone targetId={item.id} placement="before" className="top-0 h-1/4" />
      <DropZone
        targetId={item.id}
        placement="inside"
        className="top-1/4 h-1/2"
      />
      <DropZone
        targetId={item.id}
        placement="after"
        className="bottom-0 h-1/4"
      />
      {hovered && over?.placement !== "inside" && (
        <span
          className={cn(
            "pointer-events-none absolute inset-x-3 h-0.5",
            error ? "bg-destructive" : "bg-primary",
            over?.placement === "before" ? "top-0" : "bottom-0",
          )}
        />
      )}
    </div>
  );
}
