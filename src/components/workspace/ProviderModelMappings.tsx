import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProviderModelInput } from "./ProviderModelInput";
import {
  envText,
  hasOneM,
  modelFields,
  setProviderEnv,
  stripOneM,
  withOneM,
} from "@/lib/providerSettings";
import type { ProviderProfile } from "@/lib/types";
import type { RemoteModel } from "@/lib/providers";

function OneM({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Label
      className="flex h-9 shrink-0 items-center gap-2 whitespace-nowrap text-xs font-normal"
      title="声明模型支持 1M 上下文"
    >
      <Checkbox
        aria-label={`${label} 1M 上下文`}
        checked={hasOneM(value)}
        disabled={!stripOneM(value).trim()}
        onCheckedChange={(checked) =>
          onChange(withOneM(value, checked === true))
        }
      />
      1M
    </Label>
  );
}
export function ProviderModelMappings({
  profile,
  onChange,
  models,
}: {
  profile: ProviderProfile;
  onChange: (profile: ProviderProfile) => void;
  models: RemoteModel[];
}) {
  const subagent = envText(profile, "CLAUDE_CODE_SUBAGENT_MODEL");
  return (
    <div className="space-y-5">
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <ProviderModelInput
            id="provider-model"
            label="默认模型"
            value={stripOneM(profile.defaultModel)}
            onChange={(value) =>
              onChange({
                ...profile,
                defaultModel: withOneM(
                  value,
                  hasOneM(value) || hasOneM(profile.defaultModel),
                ),
              })
            }
            models={models}
          />
        </div>
        <OneM
          label="默认模型"
          value={profile.defaultModel}
          onChange={(defaultModel) => onChange({ ...profile, defaultModel })}
        />
      </div>
      <div className="space-y-3">
        <div className="hidden gap-3 px-1 text-xs text-muted-foreground md:grid md:grid-cols-[64px_minmax(0,1fr)_minmax(0,1.5fr)_56px]">
          <span>模型</span>
          <span>显示名称</span>
          <span>请求模型 ID</span>
          <span>上下文</span>
        </div>
        {modelFields.slice(1).map(([field, key, label]) => (
          <div
            key={field}
            className="grid items-center gap-2 border-b pb-3 last:border-0 last:pb-0 md:grid-cols-[64px_minmax(0,1fr)_minmax(0,1.5fr)_56px] md:gap-3 md:border-0 md:pb-0"
          >
            <span className="text-sm font-medium">{label}</span>
            <Input
              aria-label={`${label} 显示名称`}
              placeholder="显示名称（可选）"
              value={envText(profile, `${key}_NAME`)}
              onChange={(event) =>
                onChange(
                  setProviderEnv(profile, `${key}_NAME`, event.target.value),
                )
              }
            />
            <ProviderModelInput
              id={field}
              label={label}
              hideLabel
              value={stripOneM(profile[field])}
              models={models}
              onChange={(value) =>
                onChange({
                  ...profile,
                  [field]: withOneM(
                    value,
                    hasOneM(value) || hasOneM(profile[field]),
                  ),
                })
              }
            />
            <OneM
              label={label}
              value={profile[field]}
              onChange={(value) => onChange({ ...profile, [field]: value })}
            />
          </div>
        ))}
      </div>
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <ProviderModelInput
            id="provider-subagent"
            label="子代理模型"
            value={stripOneM(subagent)}
            models={models}
            onChange={(value) =>
              onChange(
                setProviderEnv(
                  profile,
                  "CLAUDE_CODE_SUBAGENT_MODEL",
                  withOneM(value, hasOneM(value) || hasOneM(subagent)),
                ),
              )
            }
          />
        </div>
        <OneM
          label="子代理模型"
          value={subagent}
          onChange={(value) =>
            onChange(
              setProviderEnv(profile, "CLAUDE_CODE_SUBAGENT_MODEL", value),
            )
          }
        />
      </div>
      <p className="text-xs text-muted-foreground">
        留空沿用 Claude Code 默认值。1M 需要服务端模型支持。
      </p>
    </div>
  );
}
