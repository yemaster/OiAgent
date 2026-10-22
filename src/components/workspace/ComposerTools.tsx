import { useRef, useState, type ReactNode, type RefObject } from "react";
import { FileText, Plus, Settings2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TaskTemplates } from "./TaskTemplates";
import { PromptOptimizer } from "./PromptOptimizer";

export function ComposerTools({
  prompt,
  onChange,
  onSettings,
  onAdvanced,
  disabled,
  textTools = true,
  settings,
  triggerRef,
}: {
  prompt: string;
  onChange: (value: string) => void;
  onSettings: () => void;
  onAdvanced: () => void;
  disabled?: boolean;
  textTools?: boolean;
  settings?: ReactNode;
  triggerRef?: RefObject<HTMLButtonElement | null>;
}) {
  const [templates, setTemplates] = useState(false);
  const [optimizer, setOptimizer] = useState(false);
  const openingTool = useRef(false);
  const localTrigger = useRef<HTMLButtonElement>(null);
  const trigger = triggerRef ?? localTrigger;
  const menu = (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={trigger}
          variant="ghost"
          size="icon-sm"
          aria-label="任务工具"
          title="任务工具"
          disabled={disabled}
        >
          <Plus />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-44"
        onCloseAutoFocus={(event) => {
          if (openingTool.current) event.preventDefault();
          openingTool.current = false;
        }}
      >
        {textTools && (
          <>
            <DropdownMenuItem
              onSelect={() => {
                openingTool.current = true;
                setTemplates(true);
              }}
            >
              <FileText />
              任务模板
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                openingTool.current = true;
                setOptimizer(true);
              }}
            >
              <WandSparkles />
              优化 Prompt
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {settings}
        <DropdownMenuItem
          onSelect={() => {
            openingTool.current = true;
            onAdvanced();
          }}
        >
          <Settings2 />
          更多设置
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <>
      {textTools ? (
        <PromptOptimizer
          prompt={prompt}
          onChange={onChange}
          onSettings={onSettings}
          open={optimizer}
          onOpenChange={setOptimizer}
        >
          {menu}
        </PromptOptimizer>
      ) : (
        menu
      )}
      <TaskTemplates
        prompt={prompt}
        onChange={onChange}
        open={templates}
        onOpenChange={setTemplates}
        onCloseFocus={() => trigger.current?.focus()}
      />
    </>
  );
}
