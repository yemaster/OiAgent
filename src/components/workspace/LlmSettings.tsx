import { useEffect, useState } from "react";
import { Save, Plug, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionHeading } from "./shared";
import { call, desktop } from "@/lib/api";

export interface LlmDraft {
  url: string;
  model: string;
  key: string;
}
export function LlmSettings({
  value,
  onChange,
}: {
  value: LlmDraft;
  onChange: (value: LlmDraft) => void;
}) {
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
        config: { baseUrl: value.url, model: value.model, apiKey: value.key },
      });
      localStorage.setItem("oiagent-api-url", value.url);
      localStorage.setItem("oiagent-api-model", value.model);
      setConfigured(true);
      onChange({ ...value, key: "" });
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
    <>
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
        Prompt 优化与自动派发
      </SectionHeading>
      <Card className="gap-0 rounded-lg py-0 shadow-none">
        <CardContent className="space-y-5 p-6">
          <div className="space-y-2">
            <Label htmlFor="api-url">API Base URL</Label>
            <Input
              id="api-url"
              placeholder="https://your-provider.com/v1"
              disabled={busy}
              value={value.url}
              onChange={(e) => onChange({ ...value, url: e.target.value })}
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
                disabled={busy}
                value={value.model}
                onChange={(e) => onChange({ ...value, model: e.target.value })}
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
                disabled={busy}
                value={value.key}
                onChange={(e) => onChange({ ...value, key: e.target.value })}
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
              disabled={busy || !desktop || !value.url || !value.model}
              onClick={() => void save(true)}
            >
              <Plug />
              测试连接
            </Button>
            <Button
              disabled={busy || !desktop || !value.url || !value.model}
              onClick={() => void save()}
            >
              <Save />
              保存配置
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
