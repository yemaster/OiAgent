import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Choice, PageHeading } from "./shared";
import { call, desktop } from "@/lib/api";
import type { ProviderProfile } from "@/lib/types";
const blank: ProviderProfile = {
  id: "",
  name: "",
  baseUrl: "",
  authType: "auth-token",
  defaultModel: "",
  haikuModel: "",
  sonnetModel: "",
  opusModel: "",
  hasKey: false,
};
export function ProviderManager({
  profiles,
  onChanged,
}: {
  profiles: ProviderProfile[];
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState(blank);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  function edit(p = blank) {
    setProfile({ ...p });
    setApiKey("");
    setOpen(true);
  }
  async function save() {
    setBusy(true);
    try {
      await call("save_provider", { profile, apiKey });
      await onChanged();
      setApiKey("");
      setOpen(false);
      toast.success("API 配置已保存");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <PageHeading title="Claude Code API 配置">
        <Button onClick={() => edit()}>
          <Plus />
          添加 API
        </Button>
      </PageHeading>
      <div className="divide-y rounded-lg border">
        {!profiles.length && (
          <p className="p-5 text-sm text-muted-foreground">
            默认沿用 Claude Code 本机配置。可添加多套 API，在任务中单独选择。
          </p>
        )}
        {profiles.map((p) => (
          <div key={p.id} className="flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{p.name}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {p.baseUrl}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {p.defaultModel || "默认模型"} ·{" "}
                {p.hasKey ? "密钥已保存" : "未设置密钥"}
              </p>
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`编辑 API：${p.name}`}
              onClick={() => edit(p)}
            >
              <Pencil />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`删除 API：${p.name}`}
              disabled={busy || !desktop}
              onClick={async () => {
                setBusy(true);
                try {
                  await call("remove_provider", { id: p.id });
                  await onChanged();
                } catch (e) {
                  toast.error(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setApiKey("");
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {profile.id ? "编辑 API 配置" : "添加 API 配置"}
            </DialogTitle>
            <DialogDescription>
              使用兼容 Anthropic Messages 的服务。配置仅应用到选中的任务。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="provider-name">名称</Label>
              <Input
                id="provider-name"
                value={profile.name}
                onChange={(e) =>
                  setProfile({ ...profile, name: e.target.value })
                }
                placeholder="例如：个人 API / 团队网关"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="provider-url">Base URL</Label>
              <Input
                id="provider-url"
                value={profile.baseUrl}
                onChange={(e) =>
                  setProfile({ ...profile, baseUrl: e.target.value })
                }
                placeholder="https://api.anthropic.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="provider-key">API Key</Label>
              <Input
                id="provider-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  profile.hasKey ? "留空保留现有密钥" : "填写 API Key"
                }
              />
              <p className="text-xs text-muted-foreground">
                密钥存入 macOS 钥匙串，不写入任务记录。
              </p>
            </div>
            <Choice
              label="API 鉴权方式"
              value={profile.authType}
              onChange={(v) => setProfile({ ...profile, authType: v })}
              options={[
                { value: "auth-token", label: "Bearer Token · 中转服务常用" },
                { value: "api-key", label: "API Key · Anthropic 官方" },
              ]}
              className="w-full"
            />
            <div className="space-y-2">
              <Label htmlFor="provider-model">默认模型</Label>
              <Input
                id="provider-model"
                value={profile.defaultModel}
                onChange={(e) =>
                  setProfile({ ...profile, defaultModel: e.target.value })
                }
                placeholder="模型 ID 或 sonnet / opus / haiku"
              />
            </div>
            <details>
              <summary className="cursor-pointer text-sm">模型映射</summary>
              <div className="mt-3 space-y-3">
                {(
                  [
                    ["haikuModel", "Haiku"],
                    ["sonnetModel", "Sonnet"],
                    ["opusModel", "Opus"],
                  ] as const
                ).map(([field, label]) => (
                  <div key={field} className="space-y-2">
                    <Label htmlFor={field}>{label}</Label>
                    <Input
                      id={field}
                      value={profile[field]}
                      onChange={(e) =>
                        setProfile({ ...profile, [field]: e.target.value })
                      }
                      placeholder={`此 API 的 ${label} 模型 ID`}
                    />
                  </div>
                ))}
              </div>
            </details>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              disabled={
                busy ||
                !desktop ||
                !profile.name.trim() ||
                !profile.baseUrl.trim()
              }
              onClick={() => void save()}
            >
              保存配置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
