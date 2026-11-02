import { useRef, useState } from "react";
import { Braces, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  importProviderSettings,
  providerSettings,
} from "@/lib/providerSettings";
import type { ProviderDraft } from "@/lib/providers";

export function ProviderJsonConfig({
  draft,
  onChange,
  disabled,
}: {
  draft: ProviderDraft;
  onChange: (draft: ProviderDraft) => void;
  disabled: boolean;
}) {
  const [mode, setMode] = useState<"import" | "edit" | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const serial = useRef(0);
  const close = () => {
    serial.current++;
    setMode(null);
    setText("");
    setError("");
  };
  function open(edit: boolean) {
    serial.current++;
    setText(edit ? JSON.stringify(providerSettings(draft), null, 2) : "");
    setError("");
    setMode(edit ? "edit" : "import");
  }
  async function read(file?: File) {
    if (!file) return;
    const request = ++serial.current;
    if (file.size > 512 * 1024) {
      setError("配置文件不能超过 512 KB");
      return;
    }
    try {
      const value = await file.text();
      if (request === serial.current) {
        setText(value);
        setError("");
      }
    } catch {
      if (request === serial.current) setError("无法读取 JSON 文件");
    }
  }
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => open(false)}
        >
          <Upload />
          导入 JSON
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => open(true)}
        >
          <Braces />
          编辑 JSON
        </Button>
      </div>
      <Dialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {mode === "edit" ? "编辑 JSON 配置" : "导入 JSON 配置"}
            </DialogTitle>
            <DialogDescription>
              粘贴 Claude Code 配置，或选择 JSON 文件。
            </DialogDescription>
          </DialogHeader>
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            aria-label="JSON 配置文件"
            onChange={(event) => {
              void read(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <Textarea
            aria-label="JSON 配置"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setError("");
            }}
            spellCheck={false}
            className="h-80 resize-y whitespace-pre font-mono text-xs"
            placeholder={'{\n  "env": {}\n}'}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="sm:justify-between">
            <Button variant="outline" onClick={() => input.current?.click()}>
              <Upload />
              选择文件
            </Button>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>
                取消
              </Button>
              <Button
                disabled={!text.trim()}
                onClick={() => {
                  try {
                    onChange(importProviderSettings(draft, text));
                    close();
                  } catch (error) {
                    setError((error as Error).message);
                  }
                }}
              >
                应用配置
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
