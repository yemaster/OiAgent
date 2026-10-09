import "@/lib/monaco";
import Editor, { DiffEditor } from "@monaco-editor/react";
import { useTheme } from "next-themes";
import { useState } from "react";
import {
  Save,
  RefreshCw,
  FileCode2,
  GitCompareArrows,
  WrapText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { dirtyFile, language, type OpenFile } from "@/lib/files";
import { projectName } from "@/lib/types";
export function FileEditor({
  file,
  onChange,
  onSave,
  onReload,
  onResolve,
  onOpen,
}: {
  file: OpenFile;
  onChange: (text: string) => void;
  onSave: () => void;
  onReload: () => void;
  onResolve: (useDisk: boolean) => void;
  onOpen: (project: string, path: string, mode: "edit" | "diff") => void;
}) {
  const { resolvedTheme } = useTheme();
  const [wrap, setWrap] = useState(!!file.skill);
  const [sideBySide, setSideBySide] = useState(true);
  const theme = resolvedTheme === "dark" ? "vs-dark" : "vs";
  const diff = file.mode === "diff" || !!file.conflict;
  const options = {
    automaticLayout: true,
    minimap: { enabled: false },
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
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
        <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
        <span
          className="min-w-0 flex-1 truncate text-xs"
          title={`${file.project}/${file.path}`}
        >
          {file.path}
        </span>
        <span className="text-xs text-muted-foreground">
          {file.mode === "diff"
            ? "只读对比"
            : dirtyFile(file)
              ? "未保存"
              : "已保存"}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="自动换行"
          aria-pressed={wrap}
          onClick={() => setWrap((v) => !v)}
        >
          <WrapText />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="刷新磁盘文件"
          disabled={file.loading || file.saving}
          onClick={onReload}
        >
          <RefreshCw />
        </Button>
        {diff && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSideBySide((v) => !v)}
          >
            {sideBySide ? "统一视图" : "左右对比"}
          </Button>
        )}
        {file.mode === "diff" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpen(file.project, file.path, "edit")}
          >
            打开文件
          </Button>
        ) : (
          <>
            {!file.skill && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onOpen(file.project, file.path, "diff")}
              >
                <GitCompareArrows />
                查看改动
              </Button>
            )}
            <Button
              size="sm"
              disabled={
                !dirtyFile(file) ||
                file.saving ||
                !!file.conflict ||
                !!file.error
              }
              onClick={onSave}
            >
              <Save />
              {file.saving ? "保存中…" : "保存"}
            </Button>
          </>
        )}
      </div>
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
          <div role="alert" className="space-y-3 p-6 text-sm">
            <p>{file.error}</p>
            <Button variant="outline" size="sm" onClick={onReload}>
              重新读取
            </Button>
          </div>
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
          <Editor
            height="100%"
            path={`oiagent://file/${encodeURIComponent(file.project)}/${file.path}`}
            language={language(file.path)}
            value={file.content}
            theme={theme}
            options={options}
            saveViewState
            onChange={(v) => onChange(v ?? "")}
            loading={
              <p className="p-6 text-sm text-muted-foreground">
                正在加载编辑器…
              </p>
            }
          />
        )}
      </div>
      <div className="flex h-7 shrink-0 items-center gap-3 border-t px-4 text-[11px] text-muted-foreground">
        <span>{projectName(file.project)}</span>
        <span className="ml-auto">{language(file.path)}</span>
        <span>UTF-8</span>
        <span>⌘ / Ctrl S 保存</span>
      </div>
    </section>
  );
}
