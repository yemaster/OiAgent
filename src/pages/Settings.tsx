import { AppearanceSettings } from "@/components/workspace/AppearanceSettings";
import { About } from "@/components/workspace/About";
import { LlmSettings, type LlmDraft } from "@/components/workspace/LlmSettings";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeading } from "@/components/workspace/shared";
import { pageNames } from "@/lib/navigation";
import type { SettingsPageId } from "@/lib/types";

export function SettingsPage({
  page,
  dataDir,
  autoRefresh,
  setAutoRefresh,
  llmDraft,
  onLlmDraft,
}: {
  page: SettingsPageId;
  dataDir: string;
  autoRefresh: boolean;
  setAutoRefresh: (value: boolean) => void;
  llmDraft: LlmDraft;
  onLlmDraft: (value: LlmDraft) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-4xl p-5 lg:p-8">
      <PageHeading title={pageNames[page]} />
      {page === "settings-appearance" && <AppearanceSettings />}
      {page === "settings-llm" && (
        <LlmSettings value={llmDraft} onChange={onLlmDraft} />
      )}
      {page === "settings" && (
        <Card className="gap-0 rounded-lg py-0 shadow-none">
          <CardContent className="divide-y px-6">
            <div className="flex items-center justify-between gap-6 py-5">
              <div>
                <Label htmlFor="auto-refresh">自动同步历史记录</Label>
                <p className="mt-2 text-xs text-muted-foreground">
                  每 15 秒检查本机历史文件的变化。
                </p>
              </div>
              <Switch
                id="auto-refresh"
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
              />
            </div>
            <div className="py-5">
              <Label>本地数据目录</Label>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all text-xs leading-6 text-muted-foreground">
                  {dataDir}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="复制数据目录"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(dataDir)
                      .then(() => toast.success("已复制"))
                      .catch(() => toast.error("无法访问剪贴板"))
                  }
                >
                  <Copy />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      {page === "settings-about" && <About />}
    </div>
  );
}
