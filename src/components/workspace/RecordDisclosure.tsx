import { useId, useRef, useState, type ReactNode } from "react";
import { ChevronRight, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Closed records do not mount code blocks, Markdown, images or nested tools. */
export function RecordDisclosure({
  title,
  children,
  expanded = false,
}: {
  title: ReactNode;
  children: ReactNode | (() => ReactNode);
  expanded?: boolean;
}) {
  const [manual, setManual] = useState<boolean>();
  const open = expanded || (manual ?? false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setManual(false);
    trigger.current?.focus({ preventScroll: true });
    trigger.current?.scrollIntoView({ block: "nearest" });
  };
  return (
    <div className="min-w-0 text-xs text-muted-foreground">
      <Button
        ref={trigger}
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setManual(!open)}
        className="h-auto max-w-full justify-start gap-2 px-1 py-2 font-normal"
      >
        <ChevronRight
          className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="min-w-0 truncate">{title}</span>
      </Button>
      {open && (
        <div id={id} className="ml-2 border-l pl-3">
          <div className="max-h-[min(24rem,45dvh)] overflow-y-auto overscroll-contain py-2 leading-6">
            {typeof children === "function" ? children() : children}
          </div>
          <Button
            variant="ghost"
            size="xs"
            onClick={close}
            className="my-1 font-normal"
          >
            <ChevronUp className="size-3" />
            收起
          </Button>
        </div>
      )}
    </div>
  );
}
