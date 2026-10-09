import { AppearanceSettings } from "@/components/workspace/AppearanceSettings";
import { useEffect, useState } from "react";
import { Save, Plug, Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeading, SectionHeading } from "@/components/workspace/shared";
import { call, desktop } from "@/lib/api";
export function SettingsPage({
  dataDir,
  autoRefresh,
  setAutoRefresh,
}: {
  dataDir: string;
  autoRefresh: boolean;
  setAutoRefresh: (v: boolean) => void;
}) {
  const [url, setUrl] = useState(localStorage.getItem("oiagent-api-url") || "");
  const [model, setModel] = useState(
    localStorage.getItem("oiagent-api-model") || "",
  );
  const [key, setKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void call<{ configured: boolean }>("llm_status")
      .then((r) => setConfigured(r.configured))
      .catch((e) => toast.error(String(e)));
  }, []);
  async function save(test = false) {
    setBusy(true);
    try {
      await call("configure_llm", {
        config: { baseUrl: url, model, apiKey: key },
      });
      localStorage.setItem("oiagent-api-url", url);
      localStorage.setItem("oiagent-api-model", model);
      setConfigured(true);
      if (test) {
        await call("test_llm");
        toast.success("LLM 连接成功");
      } else toast.success("LLM 配置已保存到当前应用会话");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto w-full max-w-4xl p-5 lg:p-8">
      <PageHeading title="设置偏好" />
      <AppearanceSettings />
      <SectionHeading
        action={
          configured ? (
            <Badge
              variant="secondary"
              className="bg-transparent text-muted-foreground [&_svg]:text-emerald-600"
            >
              <Check className="size-3" />
              已配置
            </Badge>
          ) : undefined
        }
      >
        超级 Agent · LLM API
      </SectionHeading>
      <Card className="gap-0 rounded-lg py-0 shadow-none">
        <CardContent className="space-y-5 p-6">
          <div className="space-y-2">
            <Label htmlFor="api-url">API Base URL</Label>
            <Input
              id="api-url"
              placeholder="https://your-provider.com/v1"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              支持兼容 Chat Completions 的服务，地址包含 /v1 等 API 前缀。
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="api-model">模型</Label>
              <Input
                id="api-model"
                placeholder="服务商提供的模型名称"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-key">API Key</Label>
              <Input
                id="api-key"
                type="password"
                autoComplete="off"
                placeholder={
                  configured ? "留空沿用本次会话的 Key" : "本地无鉴权服务可留空"
                }
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs leading-6 text-muted-foreground">
            API Key
            仅保存在本次应用内存中，重启后需重新填写。连接测试会向该服务发送一条简短请求。
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy || !desktop || !url || !model}
              onClick={() => void save(true)}
            >
              <Plug />
              测试连接
            </Button>
            <Button
              disabled={busy || !desktop || !url || !model}
              onClick={() => void save()}
            >
              <Save />
              保存配置
            </Button>
          </div>
        </CardContent>
      </Card>
      <div className="mt-8">
        <SectionHeading>工作区</SectionHeading>
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
            <div className="py-5">
              <p className="text-sm font-medium">
                OiAgent{" "}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  0.1.0
                </span>
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Tauri · React · shadcn/ui
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
