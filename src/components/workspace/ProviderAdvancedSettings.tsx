import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Choice } from "./shared";
import { ProviderModelInput } from "./ProviderModelInput";
import { envText, object, setProviderEnv } from "@/lib/providerSettings";
import type { ProviderProfile } from "@/lib/types";
import type { RemoteModel } from "@/lib/providers";

export function ProviderAdvancedSettings({
  profile,
  onChange,
  models,
}: {
  profile: ProviderProfile;
  onChange: (profile: ProviderProfile) => void;
  models: RemoteModel[];
}) {
  const settings = profile.settings || {};
  const setSetting = (key: string, value: unknown) =>
    onChange({ ...profile, settings: { ...settings, [key]: value } });
  const plugins = Object.entries(object(settings.enabledPlugins));
  return (
    <details className="group border-t pt-6">
      <summary className="cursor-pointer text-sm font-medium">更多配置</summary>
      <div className="space-y-5 pt-5">
        <ProviderModelInput
          id="provider-start-model"
          label="启动模型（settings.model）"
          value={typeof settings.model === "string" ? settings.model : ""}
          models={models}
          onChange={(value) => {
            const next = { ...settings };
            if (value) next.model = value;
            else delete next.model;
            onChange({ ...profile, settings: next });
          }}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>思考强度</Label>
            <Choice
              label="思考强度"
              className="w-full"
              value={envText(profile, "CLAUDE_CODE_EFFORT_LEVEL") || "default"}
              onChange={(value) =>
                onChange(
                  setProviderEnv(
                    profile,
                    "CLAUDE_CODE_EFFORT_LEVEL",
                    value === "default" ? "" : value,
                  ),
                )
              }
              options={[
                { value: "default", label: "沿用默认" },
                ...["low", "medium", "high", "xhigh", "max"].map((value) => ({
                  value,
                  label: value,
                })),
              ]}
            />
          </div>
          {[
            ["API_TIMEOUT_MS", "请求超时（毫秒）"],
            ["MAX_THINKING_TOKENS", "思考 Token 上限"],
            ["CLAUDE_CODE_MAX_OUTPUT_TOKENS", "输出 Token 上限"],
            ["CLAUDE_CODE_AUTO_COMPACT_WINDOW", "自动压缩窗口（Token）"],
          ].map(([key, label]) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={key}>{label}</Label>
              <Input
                id={key}
                type="number"
                min={0}
                step={1}
                placeholder="沿用默认"
                value={envText(profile, key)}
                onChange={(event) =>
                  onChange(setProviderEnv(profile, key, event.target.value))
                }
              />
            </div>
          ))}
        </div>
        <div className="divide-y border-y">
          {[
            ["skipWebFetchPreflight", "跳过 WebFetch 预检查"],
            ["skipDangerousModePermissionPrompt", "跳过危险模式确认提示"],
            ["alwaysThinkingEnabled", "启用扩展思考"],
          ].map(([key, label]) => (
            <div
              key={key}
              className="flex items-center justify-between gap-3 py-3"
            >
              <Label htmlFor={key} className="text-sm font-normal">
                {label}
              </Label>
              <Switch
                id={key}
                size="sm"
                checked={settings[key] === true}
                onCheckedChange={(value) => setSetting(key, value)}
              />
            </div>
          ))}
          {[
            ["ENABLE_TOOL_SEARCH", "启用工具搜索", "true"],
            ["DISABLE_AUTOUPDATER", "禁用 Claude Code 自动更新", "1"],
          ].map(([key, label, enabled]) => (
            <div
              key={key}
              className="flex items-center justify-between gap-3 py-3"
            >
              <Label htmlFor={key} className="text-sm font-normal">
                {label}
              </Label>
              <Switch
                id={key}
                size="sm"
                checked={["1", "true"].includes(envText(profile, key))}
                onCheckedChange={(value) =>
                  onChange(setProviderEnv(profile, key, value ? enabled : "0"))
                }
              />
            </div>
          ))}
        </div>
        {plugins.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">插件</h3>
            {plugins.map(([name, value]) => (
              <div
                key={name}
                className="flex min-w-0 items-center justify-between gap-3 py-1.5"
              >
                <Label
                  htmlFor={`plugin-${name}`}
                  className="min-w-0 truncate text-xs font-normal"
                  title={name}
                >
                  {name}
                </Label>
                <Switch
                  id={`plugin-${name}`}
                  size="sm"
                  checked={value === true}
                  onCheckedChange={(enabled) =>
                    setSetting("enabledPlugins", {
                      ...object(settings.enabledPlugins),
                      [name]: enabled,
                    })
                  }
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
