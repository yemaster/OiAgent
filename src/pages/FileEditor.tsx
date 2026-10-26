import { useEditorPreferences } from "@/lib/editorPreferences";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useShortcuts, shortcutLabel } from "@/lib/shortcuts";
import { ImagePreview } from "@/components/workspace/ImagePreview";
import { SkillWriter } from "@/components/workspace/SkillWriter";
import { skillDescription, type SkillWritingState } from "@/lib/skillWriter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAppearance } from "@/lib/appearance";
import { resolvedEditorTheme } from "@/lib/surfaceColors";
import { systemFileActions } from "@/lib/systemFiles";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { Editor, DiffEditor } from "@/components/workspace/LazyEditor";
import { useTheme } from "next-themes";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import {
  Play,
  PanelRightOpen,
  LoaderCircle,
  Save,
  RefreshCw,
  FileCode2,
  GitCompareArrows,
  WrapText,
  WandSparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  dirtyFile,
  imageFile,
  vectorFile,
  language,
  type OpenFile,
  type FileLocation,
} from "@/lib/files";
import { projectName } from "@/lib/types";
const MarkdownPreview = lazy(() =>
  import("@/components/workspace/MarkdownPreview").then((m) => ({
    default: m.MarkdownPreview,
  })),
);

function revealLocation(
  instance: editor.IStandaloneCodeEditor,
  location?: FileLocation,
) {
  if (!location) return;
  const position = instance.getModel()?.validatePosition({
    lineNumber: location.line,
    column: location.column || 1,
  });
  if (!position) return;
  instance.setPosition(position);
  instance.revealPositionInCenter(position);
  instance.focus();
}
export function FileEditor({
  file,
  onChange,
  onSave,
  onReload,
  onResolve,
  onOpen,
  onSkillWriting,
  onLlmSettings,
  onLocationRevealed,
  onRun,
}: {
  file: OpenFile;
  onSkillWriting?: (patch: Partial<SkillWritingState>) => void;
  onLlmSettings?: () => void;
  onLocationRevealed?: () => void;
  onRun?: () => Promise<void>;
  onChange: (text: string) => void;
  onSave: () => void;
  onReload: () => void;
  onResolve: (useDisk: boolean) => void;
  onOpen: (project: string, path: string, mode: "edit" | "diff") => void;
}) {
  const shortcuts = useShortcuts();
  const { resolvedTheme } = useTheme();
  const { editorTheme } = useAppearance();
  const preferences = useEditorPreferences(!!file.skill || !!file.instruction);
  const { wrap, sideBySide } = preferences;
  const setSideBySide = (value: boolean | ((old: boolean) => boolean)) =>
    preferences.update({
      sideBySide: typeof value === "function" ? value(sideBySide) : value,
    });
  const [markdownPreview, setMarkdownPreview] = useState(false);
  const [runningFile, setRunningFile] = useState(false);
  const runLock = useRef(false);
  const [source, setSource] = useState(false);
  const writerTrigger = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const location = file.location;
  useEffect(() => {
    if (editorRef.current && location) {
      revealLocation(editorRef.current, location);
      onLocationRevealed?.();
    }
  }, [location, onLocationRevealed]);
  const theme = resolvedEditorTheme(editorTheme, resolvedTheme);
  const preview =
    file.skillWriting?.open && file.skillWriting.result && !file.conflict
      ? file.skillWriting.result
      : undefined;
  const diff = file.mode === "diff" || !!file.conflict;
  const picture = file.mode === "edit" && imageFile(file.path);
  const editable = !picture || vectorFile(file.path);
  const showImage = picture && !source && !file.conflict;
  const imageUrl = showImage
    ? vectorFile(file.path)
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(file.content)}`
      : file.image?.url
    : undefined;
  const showPreview = !!preview && !file.skillWriting?.editing;
  const options = {
    automaticLayout: true,
    minimap: { enabled: preferences.minimap },
    fontSize: 13,
    scrollBeyondLastLine: false,
    wordWrap: wrap ? ("on" as const) : ("off" as const),
    padding: { top: 12 },
    renderWhitespace: "selection" as const,
    readOnly: file.mode === "diff",
    smoothScrolling: true,
  };
  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label={`文件编辑器 ${file.path}`}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3 text-muted-foreground">
        <FileCode2 className="mr-1 size-4 shrink-0" />
        <span
          className="min-w-0 flex-1 truncate text-xs"
          title={`${file.project}/${file.path}`}
        >
          {file.path}
        </span>
        {file.skill && file.mode === "edit" && onSkillWriting && (
          <Button
            size="icon-sm"
            variant="ghost"
            ref={writerTrigger}
            aria-label="AI 帮写"
            title="AI 帮写"
            aria-haspopup="dialog"
            aria-expanded={!!file.skillWriting?.open}
            disabled={file.loading || !!file.error}
            onClick={() =>
              onSkillWriting({
                open: !file.skillWriting?.open,
                instruction:
                  file.skillWriting?.instruction ??
                  skillDescription(file.content),
              })
            }
          >
            <WandSparkles />
          </Button>
        )}
        {!diff && !file.error && /\.(md|markdown)$/i.test(file.path) && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="侧边预览"
            title="侧边预览"
            aria-pressed={markdownPreview}
            disabled={file.loading}
            onClick={() => setMarkdownPreview((v) => !v)}
          >
            <PanelRightOpen />
          </Button>
        )}
        {!diff &&
          !file.error &&
          onRun &&
          /\.(c|cc|cpp|cxx|py|js|mjs|cjs|go|rs)$/i.test(file.path) && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="运行文件"
              title="运行文件"
              disabled={file.loading || file.saving || runningFile}
              onClick={async () => {
                if (runLock.current) return;
                runLock.current = true;
                setRunningFile(true);
                try {
                  await onRun();
                } finally {
                  runLock.current = false;
                  setRunningFile(false);
                }
              }}
            >
              {runningFile ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Play />
              )}
            </Button>
          )}
        {file.mode === "edit" && editable && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={file.saving ? "保存中…" : "保存"}
            title="保存"
            disabled={
              !dirtyFile(file) || file.saving || !!file.conflict || !!file.error
            }
            onClick={onSave}
          >
            <Save />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="文件操作"
              title="更多操作"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!showImage && (
              <DropdownMenuCheckboxItem
                checked={wrap}
                onCheckedChange={(v) => preferences.update({ wrap: v })}
              >
                <WrapText />
                自动换行
              </DropdownMenuCheckboxItem>
            )}
            {!showImage && (
              <DropdownMenuCheckboxItem
                checked={preferences.minimap}
                onCheckedChange={(v) => preferences.update({ minimap: v })}
              >
                代码缩略图
              </DropdownMenuCheckboxItem>
            )}
            {diff && (
              <DropdownMenuCheckboxItem
                checked={sideBySide}
                onCheckedChange={setSideBySide}
              >
                左右对比
              </DropdownMenuCheckboxItem>
            )}
            {picture && vectorFile(file.path) && (
              <DropdownMenuCheckboxItem
                checked={source}
                onCheckedChange={setSource}
              >
                查看源码
              </DropdownMenuCheckboxItem>
            )}
            <DropdownMenuSeparator />
            {file.mode === "diff" ? (
              <DropdownMenuItem
                onSelect={() => onOpen(file.project, file.path, "edit")}
              >
                <FileCode2 />
                打开文件
              </DropdownMenuItem>
            ) : (
              !file.skill &&
              !file.instruction && (
                <DropdownMenuItem
                  onSelect={() => onOpen(file.project, file.path, "diff")}
                >
                  <GitCompareArrows />
                  查看改动
                </DropdownMenuItem>
              )
            )}
            <DropdownMenuItem
              disabled={file.loading || file.saving}
              onSelect={onReload}
            >
              <RefreshCw />
              刷新磁盘文件
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {systemFileActions(file.project, file.path, file.loading).map(
              (action) => (
                <DropdownMenuItem
                  key={action.label}
                  disabled={action.disabled}
                  onSelect={action.action}
                >
                  {action.label}
                </DropdownMenuItem>
              ),
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {file.skill && onSkillWriting && (
        <Dialog
          open={!!file.skillWriting?.open}
          onOpenChange={(open) => onSkillWriting({ open })}
        >
          <DialogContent
            className={`max-h-[85dvh] overflow-y-auto p-6 ${showPreview ? "sm:max-w-5xl" : "sm:max-w-xl"}`}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              writerTrigger.current?.focus();
            }}
          >
            <DialogHeader className="pr-6">
              <DialogTitle>AI 帮写</DialogTitle>
              <DialogDescription className="sr-only">
                编辑 {file.skill.name} 的编写要求并预览生成结果。
              </DialogDescription>
            </DialogHeader>
            <SkillWriter
              state={file.skillWriting || {}}
              content={file.content}
              name={file.skill.name}
              kind={file.skill.scope.kind}
              disabled={
                file.loading || file.saving || !!file.conflict || !!file.error
              }
              onState={onSkillWriting}
              onSettings={() => {
                onSkillWriting({ open: false });
                onLlmSettings?.();
              }}
              preview={
                showPreview && preview ? (
                  <div className="overflow-hidden rounded-md border">
                    <div className="flex items-center justify-between gap-3 border-b px-3 py-2 text-xs text-muted-foreground">
                      <span>当前内容 → AI 建议</span>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => setSideBySide((value) => !value)}
                      >
                        {sideBySide ? "统一视图" : "左右对比"}
                      </Button>
                    </div>
                    <DiffEditor
                      height="50vh"
                      language={language(file.path)}
                      original={file.content}
                      modified={preview.content}
                      theme={theme}
                      options={{
                        ...options,
                        readOnly: true,
                        originalEditable: false,
                        renderSideBySide: sideBySide,
                        enableSplitViewResizing: true,
                      }}
                      loading={
                        <p className="p-6 text-sm text-muted-foreground">
                          正在加载差异视图…
                        </p>
                      }
                    />
                  </div>
                ) : undefined
              }
              onApply={() => {
                if (
                  preview &&
                  preview.source === file.content &&
                  !file.conflict
                ) {
                  onChange(preview.content);
                  onSkillWriting({ open: false, result: null });
                }
              }}
            />
            {file.conflict && (
              <p role="status" className="text-xs text-destructive">
                文件存在冲突，请先处理。
              </p>
            )}
          </DialogContent>
        </Dialog>
      )}
      {file.conflict && (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted px-4 py-2 text-xs"
        >
          <span className="flex-1">
            磁盘文件已更新。左侧是磁盘版本，右侧是你的编辑；合并后再保存。
          </span>
          <Button size="xs" variant="outline" onClick={() => onResolve(true)}>
            使用磁盘版本
          </Button>
          <Button size="xs" onClick={() => onResolve(false)}>
            以右侧内容继续编辑
          </Button>
        </div>
      )}
      {diff && !file.error && (
        <div className="flex shrink-0 justify-between border-b px-4 py-1.5 text-[11px] text-muted-foreground">
          <span>{file.conflict ? "磁盘版本" : file.originalLabel}</span>
          <span>{file.conflict ? "未保存的编辑" : "当前工作区"}</span>
        </div>
      )}
      <div className="relative min-h-0 flex-1" data-file-editor>
        {file.loading ? (
          <p className="p-6 text-sm text-muted-foreground">正在读取文件…</p>
        ) : file.error ? (
          <div role="alert" className="flex h-full overflow-auto p-6 text-sm">
            <div className="m-auto w-full max-w-xl space-y-4 text-center">
              <p className="break-words text-muted-foreground">{file.error}</p>
              <div className="flex flex-wrap justify-center gap-2">
                {systemFileActions(file.project, file.path).map((action) => (
                  <Button
                    key={action.label}
                    variant="outline"
                    size="sm"
                    disabled={action.disabled}
                    onClick={action.action}
                  >
                    {action.label}
                  </Button>
                ))}
                <Button variant="ghost" size="sm" onClick={onReload}>
                  重新读取
                </Button>
              </div>
            </div>
          </div>
        ) : showImage && imageUrl ? (
          <ImagePreview
            key={imageUrl}
            src={imageUrl}
            name={file.path.split("/").at(-1)!}
          />
        ) : diff ? (
          <DiffEditor
            key={`${file.id}:${file.conflict ? "conflict" : "diff"}`}
            height="100%"
            language={language(file.path)}
            original={file.conflict?.content ?? file.original ?? ""}
            modified={file.content}
            theme={theme}
            options={{
              ...options,
              renderSideBySide: sideBySide,
              originalEditable: false,
              readOnly: !file.conflict,
              enableSplitViewResizing: true,
            }}
            onMount={(editor) => {
              const model = editor.getModifiedEditor();
              model.onDidChangeModelContent(() => {
                if (file.conflict) onChange(model.getValue());
              });
            }}
            loading={
              <p className="p-6 text-sm text-muted-foreground">
                正在加载差异视图…
              </p>
            }
          />
        ) : (
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel id="file-source" minSize="20%">
              <Editor
                height="100%"
                path={`oiagent://file/${encodeURIComponent(file.project)}/${file.path}`}
                language={language(file.path)}
                value={file.content}
                theme={theme}
                options={options}
                saveViewState
                onMount={(instance) => {
                  editorRef.current = instance;
                  revealLocation(instance, location);
                  if (location) onLocationRevealed?.();
                }}
                onChange={(v) => onChange(v ?? "")}
                loading={
                  <p className="p-6 text-sm text-muted-foreground">
                    正在加载编辑器…
                  </p>
                }
              />
            </ResizablePanel>
            {markdownPreview && /\.(md|markdown)$/i.test(file.path) && (
              <>
                <ResizableHandle className="w-px" aria-label="调整预览宽度" />
                <ResizablePanel
                  id="markdown-preview"
                  minSize="20%"
                  defaultSize="50%"
                >
                  <Suspense
                    fallback={
                      <p className="p-4 text-xs text-muted-foreground">
                        正在加载预览…
                      </p>
                    }
                  >
                    <MarkdownPreview
                      content={file.content}
                      project={file.project}
                      path={file.path}
                      onOpenFile={(project, path) =>
                        onOpen(project, path, "edit")
                      }
                    />
                  </Suspense>
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        )}
      </div>
      <div className="flex h-7 shrink-0 items-center gap-3 border-t px-4 text-[11px] text-muted-foreground">
        <span>{projectName(file.project)}</span>
        {dirtyFile(file) && <span>未保存</span>}
        <span className="ml-auto">
          {showImage
            ? file.image?.mime || "image/svg+xml"
            : language(file.path)}
        </span>
        {showImage ? (
          <span>
            {Math.max(
              1,
              Math.round(
                (file.image?.size ||
                  new TextEncoder().encode(file.content).length) / 1024,
              ),
            )}{" "}
            KB
          </span>
        ) : (
          <span>UTF-8</span>
        )}
        {editable && <span>{shortcutLabel(shortcuts["save-file"])} 保存</span>}
      </div>
    </section>
  );
}
