import { useState } from "react";
import { ArrowLeft, Download, LoaderCircle, PlugZap, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Choice, PageHeading } from "@/components/workspace/shared";
import { ProviderModelInput } from "@/components/workspace/ProviderModelInput";
import { call, desktop } from "@/lib/api";
import {
  providerTestModel,
  type ProviderDraft,
  type ModelList,
  type ConnectionTest,
} from "@/lib/providers";
export function ProviderEditor({
  draft,
  onChange,
  onBack,
  onSaved,
}: {
  draft: ProviderDraft;
  onChange: (draft: ProviderDraft) => void;
  onBack: () => void;
  onSaved: () => Promise<void>;
}) {
  const { profile, apiKey } = draft;
  const [busy, setBusy] = useState<"save" | "models" | "test" | null>(null);
  const [catalog, setCatalog] = useState<{
    source: string;
    value?: ModelList;
    error?: string;
  }>();
  const [testModel, setTestModel] = useState("");
  const [test, setTest] = useState<{
    fingerprint: string;
    value?: ConnectionTest;
    error?: string;
  }>();
  const source = JSON.stringify([profile.baseUrl, profile.authType, apiKey]);
  const model = testModel || providerTestModel(profile);
  const fingerprint = JSON.stringify([source, model, profile]);
  const models = catalog?.source === source ? catalog.value?.models || [] : [];
  const testResult = test?.fingerprint === fingerprint ? test : undefined;
  const keyChanged =
    profile.hasKey &&
    (profile.baseUrl.replace(/\/$/, "") !==
      draft.savedBaseUrl.replace(/\/$/, "") ||
      profile.authType !== draft.savedAuthType);
  const setField = (field: keyof typeof profile, value: string) =>
    onChange({ ...draft, profile: { ...profile, [field]: value } });
  async function fetchModels() {
    setBusy("models");
    try {
      const value = await call<ModelList>("fetch_provider_models", {
        profile,
        apiKey,
      });
      setCatalog({ source, value });
    } catch (e) {
      setCatalog({ source, error: String(e) });
    } finally {
      setBusy(null);
    }
  }
  async function testConnection() {
    setBusy("test");
    setTest(undefined);
    try {
      const value = await call<ConnectionTest>("test_provider_connection", {
        profile,
        apiKey,
        model,
      });
      setTest({ fingerprint, value });
    } catch (e) {
      setTest({ fingerprint, error: String(e) });
    } finally {
      setBusy(null);
    }
  }
  async function save() {
    setBusy("save");
    try {
      await call("save_provider", { profile, apiKey });
      await onSaved();
      toast.success("API 配置已保存");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="mx-auto w-full max-w-4xl p-5 lg:p-8">
      <Button
        variant="ghost"
        size="sm"
        className="mb-4 -ml-2"
        onClick={onBack}
        disabled={!!busy}
      >
        <ArrowLeft />
        返回 API 配置
      </Button>
      <PageHeading
        title={profile.id ? "编辑 Claude Code API" : "添加 Claude Code API"}
      />
      <fieldset disabled={!!busy} className="space-y-8">
        <section
          className="space-y-4"
          aria-labelledby="provider-connection-heading"
        >
          <h2 id="provider-connection-heading" className="text-sm font-medium">
            服务连接
          </h2>
          <div className="space-y-2">
            <Label htmlFor="provider-name">名称</Label>
            <Input
              id="provider-name"
              value={profile.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="例如：个人 API / 团队网关"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="provider-url">Base URL</Label>
            <Input
              id="provider-url"
              value={profile.baseUrl}
              onChange={(e) => setField("baseUrl", e.target.value)}
              placeholder="https://api.anthropic.com"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="provider-key">API Key</Label>
              <Input
                id="provider-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => onChange({ ...draft, apiKey: e.target.value })}
                placeholder={
                  profile.hasKey && !keyChanged
                    ? "留空保留现有密钥"
                    : "填写 API Key"
                }
              />
            </div>
            <div className="space-y-2">
              <Label>鉴权方式</Label>
              <Choice
                label="API 鉴权方式"
                value={profile.authType}
                onChange={(v) => setField("authType", v)}
                options={[
                  { value: "auth-token", label: "Bearer Token · 中转服务" },
                  { value: "api-key", label: "API Key · Anthropic 官方" },
                ]}
                className="w-full"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            密钥保存到系统凭据库，不写入任务记录。
            {keyChanged && "服务地址或鉴权方式已改变，请重新填写密钥。"}
          </p>
        </section>
        <section
          className="space-y-4 border-t pt-6"
          aria-labelledby="provider-models-heading"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id="provider-models-heading" className="text-sm font-medium">
              模型配置
            </h2>
            <Button
              size="sm"
              variant="outline"
              disabled={!desktop || !profile.baseUrl.trim()}
              onClick={() => void fetchModels()}
            >
              {busy === "models" ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Download />
              )}
              获取模型列表
            </Button>
          </div>
          {catalog?.source === source && (
            <p role="status" className="text-xs text-muted-foreground">
              {catalog.error ||
                (catalog.value?.models.length
                  ? `已获取 ${catalog.value.models.length} 个模型${catalog.value.truncated ? "（服务返回列表过长，仅显示部分）" : ""}`
                  : "服务未返回模型，可手动填写。")}
            </p>
          )}
          <ProviderModelInput
            id="provider-model"
            label="默认模型"
            value={profile.defaultModel}
            onChange={(v) => setField("defaultModel", v)}
            models={models}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["haikuModel", "Haiku"],
                ["sonnetModel", "Sonnet"],
                ["opusModel", "Opus"],
                ["fableModel", "Fable"],
              ] as const
            ).map(([field, label]) => (
              <ProviderModelInput
                key={field}
                id={field}
                label={label}
                value={profile[field]}
                onChange={(v) => setField(field, v)}
                models={models}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            映射决定 Claude Code 中各模型别名实际使用的模型。留空沿用 CLI
            默认值；列表不可用时可手动输入。
          </p>
        </section>
        <section
          className="space-y-4 border-t pt-6"
          aria-labelledby="provider-test-heading"
        >
          <h2 id="provider-test-heading" className="text-sm font-medium">
            连接测试
          </h2>
          <ProviderModelInput
            id="provider-test-model"
            label="测试模型"
            value={model}
            onChange={setTestModel}
            models={models}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              disabled={!desktop || !profile.baseUrl.trim() || !model.trim()}
              onClick={() => void testConnection()}
            >
              {busy === "test" ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <PlugZap />
              )}
              测试连接
            </Button>
            <p className="text-xs text-muted-foreground">
              发送一条简短 Messages 请求，可能产生少量用量。
            </p>
          </div>
          {testResult && (
            <p role={testResult.error ? "alert" : "status"} className="text-sm">
              {testResult.error ||
                `连接成功 · ${testResult.value?.model} · ${testResult.value?.latencyMs} ms`}
            </p>
          )}
        </section>
        <div className="flex justify-end gap-2 border-t pt-5">
          <Button variant="outline" onClick={onBack}>
            返回列表
          </Button>
          <Button
            disabled={
              !desktop ||
              !profile.name.trim() ||
              !profile.baseUrl.trim() ||
              (keyChanged && !apiKey)
            }
            onClick={() => void save()}
          >
            <Save />
            保存配置
          </Button>
        </div>
      </fieldset>
    </div>
  );
}
