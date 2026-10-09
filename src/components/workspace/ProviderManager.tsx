import { useState } from "react";
import { Plus, Pencil, Trash2, PlugZap, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeading } from "./shared";
import { call, desktop } from "@/lib/api";
import type { ProviderProfile } from "@/lib/types";
import { providerTestModel, type ConnectionTest } from "@/lib/providers";
export function ProviderManager({
  profiles,
  onChanged,
  onEdit,
}: {
  profiles: ProviderProfile[];
  onChanged: () => Promise<void>;
  onEdit: (profile?: ProviderProfile) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  return (
    <section>
      <PageHeading title="Claude Code API 配置">
        <Button onClick={() => onEdit()}>
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
          <div key={p.id} className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{p.name}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {p.baseUrl}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {p.defaultModel || "默认模型"} ·{" "}
                {p.hasKey ? "密钥已保存" : "未设置密钥"}
              </p>
              {results[p.id] && (
                <p role="status" className="mt-2 text-xs">
                  {results[p.id]}
                </p>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy || !desktop}
              onClick={async () => {
                if (!providerTestModel(p)) {
                  onEdit(p);
                  return;
                }
                setBusy(p.id);
                setResults((rows) => ({ ...rows, [p.id]: "正在测试…" }));
                try {
                  const result = await call<ConnectionTest>(
                    "test_provider_connection",
                    { profile: p, apiKey: "", model: providerTestModel(p) },
                  );
                  setResults((rows) => ({
                    ...rows,
                    [p.id]: `连接成功 · ${result.model} · ${result.latencyMs} ms`,
                  }));
                } catch (e) {
                  setResults((rows) => ({ ...rows, [p.id]: String(e) }));
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === p.id ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <PlugZap />
              )}
              测试连接
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`编辑 API：${p.name}`}
              onClick={() => onEdit(p)}
            >
              <Pencil />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`删除 API：${p.name}`}
              disabled={!!busy || !desktop}
              onClick={async () => {
                setBusy(p.id);
                try {
                  await call("remove_provider", { id: p.id });
                  await onChanged();
                } catch (e) {
                  toast.error(String(e));
                } finally {
                  setBusy(null);
                }
              }}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>
      {profiles.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          连接测试发送一条简短 Messages 请求，可能产生少量用量。
        </p>
      )}
    </section>
  );
}
