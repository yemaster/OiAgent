import { FileContextMenu } from "./FileContextMenu";
import { useMemo, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { ToolEvent } from "@/lib/types";
import { stepChanges } from "@/lib/stepChanges";
import { StepChanges } from "./StepChanges";
import { FileCode2, GitCompareArrows } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { EditedFile, OpenProjectFile } from "@/lib/editFiles";

const labels = { edit: "修改", add: "新增", delete: "删除", rename: "重命名" };
export function EditFileCard({
  files,
  tool,
  project,
  onOpen,
  children,
}: {
  files: EditedFile[];
  tool: ToolEvent;
  project: string;
  onOpen?: OpenProjectFile;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<string>();
  const changes = useMemo(() => stepChanges(tool, project), [tool, project]);
  return (
    <>
      <Card
        className="my-2 gap-0 rounded-lg py-0 shadow-none"
        aria-label="文件编辑记录"
      >
        <div className="px-3">{children}</div>
        <div className="divide-y border-t">
          {files.map((file) => (
            <FileContextMenu
              key={file.relativePath || file.path}
              project={project}
              path={file.relativePath || file.path}
              originalPath={file.originalPath}
              onOpen={onOpen}
              disabled={!file.relativePath}
              deleted={file.operation === "delete"}
              onViewChange={() => setSelected(file.relativePath || file.path)}
            >
              <div className="flex min-w-0 items-center gap-2 px-3 py-2">
                <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <Button
                    variant="link"
                    size="xs"
                    className="h-auto max-w-full justify-start p-0 text-foreground"
                    disabled={
                      !onOpen ||
                      !file.relativePath ||
                      file.operation === "delete"
                    }
                    aria-label={`打开文件 ${file.relativePath || file.path}`}
                    title={file.path}
                    onClick={() =>
                      onOpen?.(project, file.relativePath!, "edit")
                    }
                  >
                    <span className="truncate">
                      {file.path.split(/[\\/]/).at(-1)}
                    </span>
                  </Button>
                  <p
                    className="truncate text-[11px] text-muted-foreground"
                    title={file.path}
                  >
                    {file.relativePath || "项目外文件"}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {labels[file.operation]}
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={`查看改动 ${file.relativePath || file.path}`}
                  title="查看本次修改"
                  onClick={() => setSelected(file.relativePath || file.path)}
                >
                  <GitCompareArrows className="size-3.5" />
                  查看改动
                </Button>
              </div>
            </FileContextMenu>
          ))}
        </div>
      </Card>
      <Dialog
        open={selected !== undefined}
        onOpenChange={(open) => {
          if (!open) setSelected(undefined);
        }}
      >
        <DialogContent className="flex h-[min(78dvh,800px)] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12">
            <DialogTitle className="text-sm">本次改动</DialogTitle>
            <DialogDescription className="sr-only">
              按文件查看此工具调用的修改
            </DialogDescription>
          </DialogHeader>
          {selected !== undefined && (
            <StepChanges
              key={selected}
              changes={changes}
              project={project}
              initialPath={selected}
              onOpen={
                onOpen
                  ? (...args) => {
                      setSelected(undefined);
                      onOpen(...args);
                    }
                  : undefined
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
