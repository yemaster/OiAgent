import { useState } from "react";
import {
  FolderOpen,
  ArrowLeft,
  MoreHorizontal,
  Plus,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { call, desktop, pickDirectory } from "@/lib/api";
import { permissionNames, type Extension } from "@/lib/extensions/types";
import { ExtensionIcon } from "@/components/extensions/ExtensionIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Choice, PageHeading } from "@/components/workspace/shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
function Permissions({ plugin }: { plugin: Extension }) {
  return (
    <ul className="space-y-2 text-sm text-muted-foreground">
      {plugin.manifest.permissions.length ? (
        plugin.manifest.permissions.map((p) => (
          <li key={p}>{permissionNames[p]}</li>
        ))
      ) : (
        <li>未申请工作区或任务权限</li>
      )}
      <li>保存此插件自己的本地数据</li>
    </ul>
  );
}
function PluginSettings({
  plugin,
  onSave,
  busy,
}: {
  plugin: Extension;
  onSave: (values: Extension["settings"]) => void;
  busy: boolean;
}) {
  const [values, setValues] = useState(plugin.settings);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(values);
      }}
    >
      <h2 className="text-sm font-medium">设置</h2>
      {plugin.manifest.contributes.configuration.map((s) => (
        <div key={s.id} className="space-y-2">
          <Label htmlFor={`extension-setting-${s.id}`}>{s.title}</Label>
          {s.type === "boolean" ? (
            <Switch
              id={`extension-setting-${s.id}`}
              checked={(values[s.id] ?? s.default) === true}
              onCheckedChange={(v) => setValues({ ...values, [s.id]: v })}
              disabled={busy}
            />
          ) : (
            <Input
              id={`extension-setting-${s.id}`}
              maxLength={4000}
              value={String(values[s.id] ?? s.default)}
              onChange={(e) => setValues({ ...values, [s.id]: e.target.value })}
              disabled={busy}
            />
          )}
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        disabled={
          busy || JSON.stringify(values) === JSON.stringify(plugin.settings)
        }
      >
        保存设置
      </Button>
    </form>
  );
}
export function PluginsPage({
  initialSelection,
  items,
  warnings,
  error,
  onRefresh,
  onOpen,
  onAgents,
}: {
  initialSelection?: string;
  items: Extension[];
  warnings: string[];
  error: string;
  onRefresh: () => Promise<void>;
  onOpen: (pluginId: string, viewId: string) => void;
  onAgents: () => void;
}) {
  const [selected, setSelected] = useState<string | undefined>(
    initialSelection,
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<{
    path: string;
    plugin: Extension;
  } | null>(null);
  const [removing, setRemoving] = useState<Extension | null>(null);
  const filtered = items.filter(
    (p) =>
      `${p.manifest.name} ${p.manifest.description} ${p.manifest.id}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" || p.enabled === (filter === "enabled")),
  );
  const current =
    filtered.find((p) => p.manifest.id === selected) || filtered[0];
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }
  function choose() {
    void action(async () => {
      const path = await pickDirectory();
      if (!path) return;
      setCandidate({ path, plugin: await call("inspect_extension", { path }) });
    });
  }
  async function configure(
    p: Extension,
    enabled: boolean,
    settings = p.settings,
  ) {
    await call("configure_extension", { id: p.manifest.id, enabled, settings });
    await onRefresh();
  }
  if (candidate)
    return (
      <div className="mx-auto h-full max-w-3xl space-y-6 overflow-y-auto p-6">
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => setCandidate(null)}
        >
          <ArrowLeft />
          返回插件
        </Button>
        <PageHeading
          title={
            items.some((p) => p.manifest.id === candidate.plugin.manifest.id)
              ? "更新插件"
              : "安装插件"
          }
        />
        <div className="flex items-start gap-3">
          <ExtensionIcon
            name={candidate.plugin.manifest.contributes.views[0]?.icon}
            className="mt-1 size-6"
          />
          <div>
            <h2 className="font-medium">
              {candidate.plugin.manifest.name}{" "}
              <span className="text-xs text-muted-foreground">
                {candidate.plugin.manifest.version}
              </span>
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {candidate.plugin.manifest.description}
            </p>
            <p className="mt-2 break-all text-xs text-muted-foreground">
              {candidate.path}
            </p>
          </div>
        </div>
        <section className="space-y-3 border-t pt-5">
          <h2 className="text-sm font-medium">权限</h2>
          <Permissions plugin={candidate.plugin} />
        </section>
        <section className="space-y-3 border-t pt-5">
          <h2 className="text-sm font-medium">新增页面</h2>
          {candidate.plugin.manifest.contributes.views.map((v) => (
            <div key={v.id} className="flex items-center gap-2 text-sm">
              <ExtensionIcon name={v.icon} />
              {v.title}
              {v.activityBar && <Badge variant="secondary">工具栏入口</Badge>}
            </div>
          ))}
        </section>
        <p className="text-sm text-muted-foreground">
          安装后默认停用，请仅启用可信来源的插件。更新会保留插件数据和兼容的设置。
        </p>
        <Button
          disabled={busy}
          onClick={() =>
            void action(async () => {
              await call("install_extension", {
                path: candidate.path,
                revision: candidate.plugin.revision,
              });
              setSelected(candidate.plugin.manifest.id);
              setCandidate(null);
              await onRefresh();
              toast.success("插件已安装，可在详情中启用");
            })
          }
        >
          确认安装
        </Button>
      </div>
    );
  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-4 border-b p-5">
        <PageHeading title="插件">
          <Button variant="outline" onClick={onAgents}>
            Agent 接入
          </Button>
          <Button disabled={busy || !desktop} onClick={choose}>
            <Plus />
            从目录安装
          </Button>
        </PageHeading>
        <div className="flex gap-3">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              aria-label="搜索插件"
              placeholder="搜索插件"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Choice
            label="插件状态"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "全部" },
              { value: "enabled", label: "已启用" },
              { value: "disabled", label: "已停用" },
            ]}
          />
        </div>
        {(error || warnings.length > 0) && (
          <div role="alert" className="text-sm text-destructive">
            {error || warnings.join("；")}
            <Button size="sm" variant="ghost" onClick={() => void onRefresh()}>
              重新加载
            </Button>
          </div>
        )}
      </div>
      {!items.length ? (
        <div className="space-y-4 p-8">
          <h2 className="text-base font-medium">还没有安装应用插件</h2>
          <p className="text-sm text-muted-foreground">
            安装插件可添加工具页面和工作区操作。
          </p>
          <Button
            variant="outline"
            disabled={busy || !desktop}
            onClick={choose}
          >
            <FolderOpen />
            选择插件目录
          </Button>
          {!desktop && (
            <p className="text-xs text-muted-foreground">
              安装本地插件需要使用桌面版。
            </p>
          )}
        </div>
      ) : !current ? (
        <p className="p-6 text-sm text-muted-foreground">没有匹配的插件</p>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 @2xl:grid-cols-[220px_minmax(0,1fr)]">
          <div
            className={cn(
              "min-h-0 overflow-y-auto border-r p-2",
              selected && "hidden @2xl:block",
            )}
            aria-label="已安装插件"
          >
            {filtered.map((p) => (
              <button
                key={p.manifest.id}
                className={cn(
                  "flex w-full items-start gap-3 rounded-md p-3 text-left transition-colors",
                  current.manifest.id === p.manifest.id
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted",
                )}
                aria-pressed={current.manifest.id === p.manifest.id}
                onClick={() => setSelected(p.manifest.id)}
              >
                <ExtensionIcon
                  name={p.manifest.contributes.views[0]?.icon}
                  className="mt-0.5 size-4 shrink-0"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {p.manifest.name}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {p.enabled ? "已启用" : "已停用"} · {p.manifest.version}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div
            className={cn(
              "min-h-0 overflow-y-auto p-6",
              !selected && "hidden @2xl:block",
            )}
          >
            <Button
              variant="ghost"
              size="sm"
              className="mb-4 @2xl:hidden"
              onClick={() => setSelected(undefined)}
            >
              <ArrowLeft />
              插件列表
            </Button>
            <div className="mx-auto max-w-3xl space-y-6">
              <section className="space-y-3">
                <div className="flex items-center gap-3">
                  <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">
                    {current.manifest.name}
                  </h2>
                  <Button
                    variant={current.enabled ? "outline" : "default"}
                    disabled={busy}
                    onClick={() =>
                      void action(() => configure(current, !current.enabled))
                    }
                  >
                    {current.enabled ? "停用" : "启用"}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="插件操作"
                        disabled={busy}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={choose}>
                        从目录更新
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setRemoving(current)}
                      >
                        卸载
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <p className="text-sm text-muted-foreground">
                  {current.manifest.description}
                </p>
                <p className="text-xs text-muted-foreground">
                  {current.manifest.id} · {current.manifest.version}
                </p>
              </section>
              <section className="space-y-3 border-t pt-5">
                <h2 className="text-sm font-medium">页面</h2>
                <div className="flex flex-wrap gap-2">
                  {current.manifest.contributes.views.map((v) => (
                    <Button
                      key={v.id}
                      variant="outline"
                      disabled={!current.enabled || busy}
                      onClick={() => onOpen(current.manifest.id, v.id)}
                    >
                      <ExtensionIcon name={v.icon} />
                      {v.title}
                    </Button>
                  ))}
                </div>
              </section>
              {current.manifest.contributes.configuration.length > 0 && (
                <section className="border-t pt-5">
                  <PluginSettings
                    key={`${current.manifest.id}:${JSON.stringify(current.settings)}`}
                    plugin={current}
                    busy={busy}
                    onSave={(values) =>
                      void action(async () => {
                        await configure(current, current.enabled, values);
                        toast.success("设置已保存");
                      })
                    }
                  />
                </section>
              )}
              <details className="border-t pt-5">
                <summary className="cursor-pointer text-sm font-medium">
                  权限
                </summary>
                <div className="pt-3">
                  <Permissions plugin={current} />
                </div>
              </details>
            </div>
          </div>
        </div>
      )}
      <Dialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoving(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>卸载 {removing?.manifest.name}？</DialogTitle>
            <DialogDescription>
              此插件的设置和本地数据将被删除，项目文件与任务不受影响。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRemoving(null)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await call("remove_extension", { id: removing!.manifest.id });
                  setRemoving(null);
                  await onRefresh();
                })
              }
            >
              卸载
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
