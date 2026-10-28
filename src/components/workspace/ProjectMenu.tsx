import {
  ChevronDown,
  Folder,
  Settings2,
  FileText,
  Blocks,
  FolderOpen,
  Copy,
} from "lucide-react";
import { projectName } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { copyText } from "@/lib/clipboard";
import { systemFileActions } from "@/lib/systemFiles";
export type ProjectConfiguration = "instructions" | "integrations";
export function ProjectMenu({
  project,
  onConfigure,
  compact = false,
  onOpen,
}: {
  project: string;
  compact?: boolean;
  onOpen?: () => void;
  onConfigure?: (project: string, page: ProjectConfiguration) => void;
}) {
  const reveal = systemFileActions(project)[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={compact ? `项目操作：${projectName(project)}` : undefined}
          className="max-w-48"
        >
          {compact ? <Folder /> : <Settings2 />}
          <span className="truncate">
            {compact ? projectName(project) : "项目设置"}
          </span>
          {compact && <ChevronDown className="size-3" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {onOpen && (
          <DropdownMenuItem onSelect={onOpen}>
            <Folder />
            查看项目任务
          </DropdownMenuItem>
        )}
        {onConfigure && (
          <>
            <DropdownMenuItem
              onSelect={() => onConfigure(project, "instructions")}
            >
              <FileText />
              项目指令
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onConfigure(project, "integrations")}
            >
              <Blocks />
              MCP 与 Skills
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem disabled={reveal.disabled} onSelect={reveal.action}>
          <FolderOpen />
          在文件夹中显示
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copyText(project)}>
          <Copy />
          复制项目路径
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
