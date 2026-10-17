import "@/lib/monaco";
import { DiffEditor } from "@monaco-editor/react";
import { useTheme } from "next-themes";
import { useState } from "react";
import { Columns2, Rows2 } from "lucide-react";
import { useAppearance } from "@/lib/appearance";
import { resolvedEditorTheme } from "@/lib/surfaceColors";
import { language } from "@/lib/files";
import type { StepChange } from "@/lib/stepChanges";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "./CodeBlock";
import { copyText } from "@/lib/clipboard";

export default function StepChangePreview({ change }: { change: StepChange }) {
  const { resolvedTheme } = useTheme();
  const { editorTheme } = useAppearance();
  const [sideBySide, setSideBySide] = useState(false);
  const comparable = change.before !== undefined && change.after !== undefined;
  const pending = ["called", "running"].includes(change.state);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-9 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {change.state === "failed"
            ? "执行失败 · 计划改动"
            : pending
              ? "尚未完成 · 计划改动"
              : "本次改动"}
          {change.note
            ? ` · ${change.note}`
            : change.scope === "patch"
              ? " · 差异片段"
              : ""}
        </span>
        {comparable && (
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={sideBySide ? "统一视图" : "左右对比"}
              onClick={() => setSideBySide(!sideBySide)}
            >
              {sideBySide ? <Rows2 /> : <Columns2 />}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void copyText(change.after!)}
            >
              复制修改后
            </Button>
          </>
        )}
      </div>
      {comparable ? (
        <div className="relative min-h-0 flex-1" aria-label="本次文件差异">
          <DiffEditor
            height="100%"
            original={change.before}
            modified={change.after}
            language={language(change.path)}
            theme={resolvedEditorTheme(editorTheme, resolvedTheme)}
            options={{
              readOnly: true,
              originalEditable: false,
              renderSideBySide: sideBySide,
              automaticLayout: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 13,
              wordWrap: "on",
              renderOverviewRuler: false,
              diffWordWrap: "on",
              padding: { top: 12 },
              enableSplitViewResizing: true,
            }}
            loading={
              <p className="p-4 text-xs text-muted-foreground">加载差异…</p>
            }
          />
        </div>
      ) : change.patch ? (
        <CodeBlock
          fill
          className="rounded-none"
          language="diff"
          label="本次补丁"
          text={change.patch}
          copyLabel="复制本次补丁"
        />
      ) : change.after !== undefined && change.operation !== "delete" ? (
        <CodeBlock
          fill
          className="rounded-none"
          language={language(change.path)}
          label="写入内容"
          text={change.after}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          此步骤未记录文件差异
        </div>
      )}
    </div>
  );
}
