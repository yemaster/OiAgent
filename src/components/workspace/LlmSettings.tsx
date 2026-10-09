import { useEffect, useEffectEvent, useState } from "react";
import { Save, Plug, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { SectionHeading } from "./shared";
import { call, desktop } from "@/lib/api";

export interface LlmDraft {
  url: string;
  model: string;
  key: string;
  edited?: boolean;
}
export function LlmSettings({
  value,
  onChange,
}: {
  value: LlmDraft;
  onChange: (value: LlmDraft) => void;
}) {
  const [status, setStatus] = useState<{
    configured: boolean;
    baseUrl?: string;
    model?: string;
    hasKey?: boolean;
  }>({ configured: false });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  const restore = useEffectEvent((r: typeof status) => {
    setStatus(r);
    if (r.configured && !value.edited && !value.key) {
      const next = {
        url: r.baseUrl || "",
        model: r.model || "",
        key: "",
        edited: false,
      };
      onChange(next);
      localStorage.setItem("oiagent-api-url", next.url);
      localStorage.setItem("oiagent-api-model", next.model);
    }
  });
  useEffect(() => {
    let cancelled = false;
    void call<typeof status>("llm_status")
      .then((r) => {
        if (!cancelled) restore(r);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const configured = status.configured;
  async function save(test = false) {
    setBusy(true);
    try {
      setError("");
      const saved = await call<typeof status>("configure_llm", {
        config: { baseUrl: value.url, model: value.model, apiKey: value.key },
      });
      localStorage.setItem("oiagent-api-url", saved.baseUrl || value.url);
      localStorage.setItem("oiagent-api-model", saved.model || value.model);
      setStatus(saved);
      onChange({
        url: saved.baseUrl || value.url,
        model: saved.model || value.model,
        key: "",
        edited: false,
      });
      if (test) {
        await call("test_llm");
        toast.success("LLM 连接成功");
      } else toast.success("LLM 配置已加密保存，重启后自动恢复");
    } catch (e) {
      setError(String(e));
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
              disabled={busy || loading}
              value={value.url}
              onChange={(e) =>
                onChange({ ...value, url: e.target.value, edited: true })
              }
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
                disabled={busy || loading}
                value={value.model}
                onChange={(e) =>
                  onChange({ ...value, model: e.target.value, edited: true })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-key">API Key</Label>
              <Input
                id="api-key"
                type="password"
                autoComplete="off"
                placeholder={
                  status.hasKey &&
                  value.url.trim().replace(/\/+$/, "") === status.baseUrl
                    ? "已加密保存，留空保留"
                    : "本地无鉴权服务可留空"
                }
                disabled={busy || loading}
                value={value.key}
                onChange={(e) =>
                  onChange({ ...value, key: e.target.value, edited: true })
                }
              />
            </div>
          </div>
          <p className="text-xs leading-6 text-muted-foreground">
            API Key
            加密保存在应用数据目录，重启后自动读取，无需解锁钥匙串。连接测试会向该服务发送一条简短请求。
          </p>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            {configured && (
              <Button
                variant="ghost"
                className="mr-auto"
                disabled={busy || loading}
                onClick={() => setRemoving(true)}
              >
                <Trash2 />
                移除配置
              </Button>
            )}
            <Button
              variant="outline"
              disabled={
                busy || loading || !desktop || !value.url || !value.model
              }
              onClick={() => void save(true)}
            >
              <Plug />
              测试连接
            </Button>
            <Button
              disabled={
                busy || loading || !desktop || !value.url || !value.model
              }
              onClick={() => void save()}
            >
              <Save />
              保存配置
            </Button>
          </div>
        </CardContent>
      </Card>
      <Dialog
        open={removing}
        onOpenChange={(v) => {
          if (!busy) setRemoving(v);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>移除 LLM 配置？</DialogTitle>
            <DialogDescription>
              会删除应用内保存的 API
              Key、地址和模型。再次使用需要重新配置，已经发出的请求不受影响。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRemoving(false)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await call("clear_llm");
                  localStorage.removeItem("oiagent-api-url");
                  localStorage.removeItem("oiagent-api-model");
                  onChange({ url: "", model: "", key: "", edited: false });
                  setStatus({ configured: false });
                  setRemoving(false);
                  setError("");
                  toast.success("已移除保存的 LLM 配置");
                } catch (e) {
                  setError(String(e));
                  toast.error(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              移除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
