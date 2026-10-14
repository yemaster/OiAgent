import { useState } from "react";
import {
  Check,
  ChevronDown,
  FolderClock,
  FolderOpen,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { pickDirectory } from "@/lib/api";
import { projectName } from "@/lib/types";

export function ProjectPicker({
  projects,
  value,
  temporary,
  remote,
  disabled,
  onSelect,
}: {
  projects: string[];
  value: string;
  temporary: boolean;
  remote: boolean;
  disabled?: boolean;
  onSelect: (path: string, temporary: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const choices = [...new Set([...(value ? [value] : []), ...projects])].filter(
    (path) => path.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const customPath =
    !remote &&
    /^(\/|[a-z]:[\\/]|\\\\)/i.test(query.trim()) &&
    !choices.includes(query.trim())
      ? query.trim()
      : "";
  function choose(path: string, temporary = false) {
    onSelect(path, temporary);
    setOpen(false);
  }
  async function browse() {
    try {
      const path = await pickDirectory();
      if (path) choose(path);
    } catch (error) {
      toast.error(String(error));
    }
  }
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="选择项目"
          disabled={disabled}
          title={temporary ? "临时项目" : value}
          className="max-w-64"
        >
          {temporary ? <FolderClock /> : <FolderOpen />}
          <span className="truncate">
            {temporary ? "临时项目" : value ? projectName(value) : "选择项目"}
          </span>
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-80 max-w-[calc(100vw-2rem)] p-0"
        aria-label="选择项目"
      >
        <div className="relative border-b p-2">
          <Search className="absolute left-4 top-4 size-4 text-muted-foreground" />
          <Input
            aria-label="查找项目"
            placeholder={remote ? "搜索项目…" : "搜索项目或输入路径…"}
            className="border-0 bg-transparent pl-8 shadow-none focus-visible:ring-0"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (customPath || choices.length === 1)) {
                e.preventDefault();
                choose(customPath || choices[0]);
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                e.currentTarget
                  .closest('[data-slot="popover-content"]')
                  ?.querySelector<HTMLButtonElement>('[role="option"]')
                  ?.focus();
              }
            }}
          />
        </div>
        <div
          role="listbox"
          aria-label="可用项目"
          className="max-h-72 overflow-y-auto p-1.5"
          onKeyDown={(e) => {
            if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
            const options = Array.from(
              e.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="option"]',
              ),
            );
            const index = options.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            e.preventDefault();
            options[
              (index + (e.key === "ArrowDown" ? 1 : -1) + options.length) %
                options.length
            ]?.focus();
          }}
        >
          {!remote && !query && (
            <Button
              role="option"
              aria-selected={temporary}
              variant="ghost"
              className="h-10 w-full justify-start px-2"
              onClick={() => choose("", true)}
            >
              <FolderClock />
              临时项目{temporary && <Check className="ml-auto" />}
            </Button>
          )}
          {choices.map((path) => (
            <Button
              key={path}
              role="option"
              aria-selected={!temporary && value === path}
              variant="ghost"
              className="h-auto w-full justify-start gap-2 px-2 py-2 text-left"
              title={path}
              onClick={() => choose(path)}
            >
              <FolderOpen className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {projectName(path)}
                </span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {path}
                </span>
              </span>
              {!temporary && value === path && <Check />}
            </Button>
          ))}
          {customPath && (
            <Button
              role="option"
              aria-selected={false}
              variant="ghost"
              className="h-auto w-full justify-start px-2 py-2"
              onClick={() => choose(customPath)}
            >
              <FolderOpen />
              <span className="min-w-0 text-left">
                <span className="block">使用此路径</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {customPath}
                </span>
              </span>
            </Button>
          )}
          {!choices.length && !customPath && (
            <p className="p-3 text-xs text-muted-foreground">
              {query ? "没有匹配项目" : "暂无项目"}
            </p>
          )}
        </div>
        {!remote && (
          <div className="border-t p-1.5">
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => void browse()}
            >
              <FolderOpen />
              打开文件夹…
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
