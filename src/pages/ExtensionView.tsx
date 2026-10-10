import { useEffect, useEffectEvent, useRef, useState } from "react";
import { RefreshCw, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { call } from "@/lib/api";
import type {
  Extension,
  ExtensionPackage,
  ExtensionTab,
  ExtensionContext,
  FieldValues,
} from "@/lib/extensions/types";
import type { Task } from "@/lib/types";
import { uiValues, type UiNode } from "@/lib/extensions/ui";
import { startExtension } from "@/lib/extensions/runtime";
import { extensionBridge } from "@/lib/extensions/bridge";
import { ExtensionUi } from "@/components/extensions/ExtensionUi";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/workspace/shared";
export function ExtensionViewPage({
  plugin,
  tab,
  readValues,
  onValues,
  context,
  tasks,
  onOpen,
  onDraft,
  onManage,
}: {
  plugin?: Extension;
  tab: ExtensionTab;
  readValues: () => FieldValues;
  onValues: (values: FieldValues) => void;
  context: ExtensionContext;
  tasks: Task[];
  onOpen: (id: string) => void;
  onDraft: (value: { title: string; prompt: string }) => void;
  onManage: () => void;
}) {
  const [form, setForm] = useState<FieldValues>({});
  const [tree, setTree] = useState<UiNode | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const runtime = useRef<ReturnType<typeof startExtension> | null>(null);
  const host = useEffectEvent(() => ({
    context,
    tasks,
    onOpen,
    onDraft,
    readValues,
  }));
  const enabled =
    plugin?.enabled &&
    plugin.manifest.contributes.views.some((v) => v.id === tab.viewId);
  const revision = plugin?.revision;
  const settingsKey = JSON.stringify(plugin?.settings);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timedOut = false;
    let loadingTimer: ReturnType<typeof setTimeout> | undefined;
    const clearLoading = () => {
      clearTimeout(loadingTimer);
    };
    const fail = (message: string) => {
      if (!disposed) {
        clearLoading();
        setError(message);
      }
    };
    loadingTimer = setTimeout(() => {
      timedOut = true;
      runtime.current?.dispose();
      fail("插件未能打开页面，请重新加载或停用插件。");
    }, 20000);
    void call<ExtensionPackage>("load_extension", { id: tab.pluginId })
      .then((p) => {
        if (disposed || timedOut) return;
        const cached = host().readValues();
        setForm(cached);
        const bridge = extensionBridge(p, {
          context: () => host().context,
          tasks: () => host().tasks,
          open: (id) => host().onOpen(id),
          draft: (v) => host().onDraft(v),
          notify: (message) => toast.message(`${p.manifest.name}：${message}`),
          save: (storage) =>
            disposed
              ? Promise.reject(new Error("页面已关闭"))
              : call("extension_storage", {
                  id: tab.pluginId,
                  revision: p.revision,
                  storage,
                }),
        });
        const settings = Object.fromEntries(
          p.manifest.contributes.configuration.map((s) => [
            s.id,
            p.settings[s.id] ?? s.default,
          ]),
        );
        runtime.current = startExtension(
          p.source,
          { viewId: tab.viewId, settings, values: cached },
          {
            render: (next) => {
              clearLoading();
              setError("");
              setTree(next);
            },
            request: (method, params) =>
              disposed
                ? Promise.reject(new Error("页面已关闭"))
                : bridge(method, params),
            error: fail,
            actionError: (message) => toast.error(message),
          },
        );
      })
      .catch((e) => fail(String(e)));
    return () => {
      disposed = true;
      clearLoading();
      runtime.current?.dispose();
      runtime.current = null;
    };
  }, [tab.pluginId, tab.viewId, enabled, revision, settingsKey, reload]);
  function restart() {
    setTree(null);
    setError("");
    setReload((n) => n + 1);
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-5">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
          {tab.title}
        </h1>
        <span className="text-xs text-muted-foreground">
          {plugin?.manifest.name}
        </span>
        <IconButton
          label="重新加载插件页面"
          disabled={!enabled}
          onClick={restart}
        >
          <RefreshCw />
        </IconButton>
        <IconButton label="管理此插件" onClick={onManage}>
          <Settings2 />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        {!enabled ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              此插件页面当前不可用。
            </p>
            <Button variant="outline" onClick={onManage}>
              管理插件
            </Button>
          </div>
        ) : error ? (
          <div role="alert" className="space-y-3">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={restart}>
              重新加载
            </Button>
          </div>
        ) : tree ? (
          <div className="mx-auto max-w-5xl">
            <ExtensionUi
              node={tree}
              values={form}
              onChange={(id, value) => {
                const next = { ...form, [id]: value };
                if (JSON.stringify(next).length > 128 * 1024) {
                  toast.error("表单内容不能超过 128 KB");
                  return;
                }
                setForm(next);
                onValues(next);
              }}
              onAction={(action) =>
                runtime.current?.action({
                  action,
                  values: { ...uiValues(tree), ...form },
                })
              }
            />
          </div>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            正在加载插件…
          </p>
        )}
      </div>
    </div>
  );
}
