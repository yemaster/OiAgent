import { CircleOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { todoColors } from "@/lib/todos";
import { cn } from "@/lib/utils";
export function TodoColor({
  value,
  onChange,
  disabled,
  label = "颜色标记",
}: {
  value?: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  label?: string;
}) {
  const selected = todoColors.find((c) => c.value === value);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={label}
          title={selected?.label || "无颜色标记"}
        >
          {selected ? (
            <span className={cn("size-3 rounded-full", selected.className)} />
          ) : (
            <CircleOff className="size-4 text-muted-foreground" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <div role="group" aria-label="选择颜色标记" className="flex gap-1">
          {[{ value: "", label: "无标记", className: "" }, ...todoColors].map(
            (color) => (
              <Button
                key={color.value}
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={color.label}
                aria-pressed={(value || "") === color.value}
                className={cn(
                  (value || "") === color.value && "bg-accent ring-1 ring-ring",
                )}
                onClick={() => onChange(color.value || null)}
                title={color.label}
              >
                {color.value ? (
                  <span
                    className={cn("size-4 rounded-full", color.className)}
                  />
                ) : (
                  <CircleOff className="size-4" />
                )}
              </Button>
            ),
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
