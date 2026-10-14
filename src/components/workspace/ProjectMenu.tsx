import { Settings2, FileText, Blocks, FolderOpen, Copy } from "lucide-react";
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
}: {
  project: string;
  onConfigure?: (project: string, page: ProjectConfiguration) => void;
}) {
  const reveal = systemFileActions(project)[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          <Settings2 />
          项目设置
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
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
