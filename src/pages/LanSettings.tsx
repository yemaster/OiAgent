import { useCallback, useEffect, useState } from "react";
import { Copy, Plus, Network, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  PageHeading,
  SectionHeading,
  Choice,
  IconButton,
} from "@/components/workspace/shared";
import { call, desktop, pickDirectory } from "@/lib/api";
import { projectName, type Snapshot } from "@/lib/types";
import type {
  HostConfig,
  LanStatus,
  PairRequest,
  RemoteDevice,
} from "@/lib/lan";
const defaults: HostConfig = {
  name: "我的电脑",
  address: "",
  port: 43120,
  projects: [],
  agents: [],
  allowExecution: false,
};
export function LanSettingsPage({
  snapshot,
  devices,
  onChanged,
}: {
  snapshot: Snapshot;
  devices: RemoteDevice[];
  onChanged: () => Promise<void>;
}) {
  const [status, setStatus] = useState<LanStatus>();
  const [config, setConfig] = useState(defaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState("");
  const [connect, setConnect] = useState(false);
  const [code, setCode] = useState("");
  const [clientName, setClientName] = useState("我的电脑");
  const [pending, setPending] = useState<PairRequest>();
  const [confirm, setConfirm] = useState<{
    command: string;
    id: string;
    name: string;
  }>();
  const refresh = useCallback(async () => {
    if (!desktop) return;
    const s = await call<LanStatus>("lan_status");
    setStatus(s);
    return s;
  }, []);
  useEffect(() => {
    let active = true;
    // Synchronize the persisted host settings on mount.
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh()
      .then((s) => {
        if (active && s)
          setConfig({
            ...defaults,
            ...s.config,
            name: s.config.name || defaults.name,
            port: s.config.port || defaults.port,
            address: s.config.address || s.interfaces[0]?.address || "",
          });
      })
      .catch((e) => setError(String(e)));
    const timer = setInterval(() => void refresh().catch(() => {}), 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    let working = false;
    const timer = setInterval(async () => {
      if (working) return;
      working = true;
      try {
        const result = await call<{ approved: boolean }>(
          "lan_pair_finish",
          pending as unknown as Record<string, unknown>,
        );
        if (cancelled) return;
        if (result.approved) {
          setPending(undefined);
          setConnect(false);
          setCode("");
          toast.success("设备已配对，可以在新建任务中选择");
          await onChanged();
          await refresh();
        }
      } catch (e) {
        if (!cancelled) {
          setPending(undefined);
          setError(String(e));
        }
      } finally {
        working = false;
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pending, onChanged, refresh]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
      await onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  function choose(key: "agents" | "projects", value: string, checked: boolean) {
    setConfig((c) => ({
      ...c,
      [key]: checked ? [...c[key], value] : c[key].filter((x) => x !== value),
    }));
  }
  const projects = [...new Set([...snapshot.projects, ...config.projects])];
  return (
    <div className="mx-auto w-full max-w-4xl p-5 lg:p-8">
      <PageHeading title="局域网连接">
        <Button
          variant="outline"
          disabled={!desktop || busy}
          onClick={() => void action(async () => {})}
        >
          <RefreshCw />
          刷新
        </Button>
      </PageHeading>
      {!desktop && (
        <p className="mb-5 text-sm text-muted-foreground">
          局域网配对需要在 OiAgent 桌面版中操作。
        </p>
      )}
      {(error || status?.error) && (
        <p role="alert" className="mb-5 text-sm text-destructive">
          {error || status?.error}
        </p>
      )}
      <Card className="gap-0 rounded-lg py-0 shadow-none">
        <CardContent className="space-y-5 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="lan-sharing" className="text-sm font-medium">
                共享本机
              </Label>
              <p className="mt-2 text-xs text-muted-foreground">
                {status?.enabled
                  ? `${config.address}:${config.port} · 已开启`
                  : "开启后，已授权的 OiAgent 设备可连接本机。重启后默认关闭。"}
              </p>
            </div>
            <Switch
              id="lan-sharing"
              checked={status?.enabled || false}
              disabled={!desktop || busy || !status}
              onCheckedChange={(enabled) =>
                void action(async () => {
                  const next = await call<LanStatus>(
                    enabled ? "lan_enable" : "lan_disable",
                    enabled ? { config } : {},
                  );
                  setConfig(next.config);
                  if (!enabled) setInvite("");
                })
              }
            />
          </div>
          {!status?.enabled ? (
            <div className="space-y-5 border-t pt-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="lan-name">本机名称</Label>
                  <Input
                    id="lan-name"
                    value={config.name}
                    onChange={(e) =>
                      setConfig({ ...config, name: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>监听地址</Label>
                  <Choice
                    label="监听地址"
                    value={config.address}
                    onChange={(address) => setConfig({ ...config, address })}
                    options={(status?.interfaces || []).map((i) => ({
                      value: i.address,
                      label: `${i.address} · ${i.name}`,
                    }))}
                  />
                </div>
              </div>
              {!status?.interfaces.length && desktop && (
                <p className="text-xs text-muted-foreground">
                  未找到私有局域网地址，请先连接 Wi-Fi 或有线网络。
                </p>
              )}
              <div>
                <SectionHeading
                  action={
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={!desktop}
                      onClick={async () => {
                        try {
                          const p = await pickDirectory();
                          if (p && !config.projects.includes(p))
                            choose("projects", p, true);
                        } catch (e) {
                          toast.error(String(e));
                        }
                      }}
                    >
                      <Plus />
                      添加目录
                    </Button>
                  }
                >
                  共享项目
                </SectionHeading>
                <div className="max-h-40 space-y-3 overflow-auto">
                  {projects.map((p) => (
                    <label key={p} className="flex items-center gap-3 text-sm">
                      <Checkbox
                        checked={config.projects.includes(p)}
                        onCheckedChange={(v) =>
                          choose("projects", p, v === true)
                        }
                      />
                      <span className="min-w-0">
                        <span>{projectName(p)}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {p}
                        </span>
                      </span>
                    </label>
                  ))}
                  {!projects.length && (
                    <p className="text-xs text-muted-foreground">
                      添加允许远程任务使用的项目目录。
                    </p>
                  )}
                </div>
              </div>
              <div>
                <SectionHeading>可用 Agent</SectionHeading>
                <div className="flex flex-wrap gap-4">
                  {snapshot.agents
                    .filter((a) => a.available && !a.custom)
                    .map((a) => (
                      <label
                        key={a.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={config.agents.includes(a.id)}
                          onCheckedChange={(v) =>
                            choose("agents", a.id, v === true)
                          }
                        />
                        {a.name}
                      </label>
                    ))}
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Checkbox
                  id="lan-execute"
                  checked={config.allowExecution}
                  onCheckedChange={(v) =>
                    setConfig({ ...config, allowExecution: v === true })
                  }
                />
                <div>
                  <Label htmlFor="lan-execute">
                    允许已配对设备新建和操作任务
                  </Label>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    Agent 使用本机账户和 API
                    执行，可能修改文件、调用工具并产生费用。项目列表限制任务起始目录，不是操作系统沙箱。
                  </p>
                </div>
              </div>
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  高级连接设置
                </summary>
                <div className="mt-3 flex items-center gap-3">
                  <Label htmlFor="lan-port">端口</Label>
                  <Input
                    id="lan-port"
                    className="w-28"
                    type="number"
                    min={1024}
                    max={65535}
                    value={config.port}
                    onChange={(e) =>
                      setConfig({ ...config, port: Number(e.target.value) })
                    }
                  />
                </div>
              </details>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <span className="text-xs text-muted-foreground">
                共享 {config.projects.length} 个项目 · {config.agents.length} 个
                Agent ·{" "}
                {config.allowExecution ? "可执行任务" : "仅查看已有任务"}
              </span>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void action(async () =>
                    setInvite(await call<string>("lan_invite")),
                  )
                }
              >
                <Network />
                生成配对码
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      {!!status?.pending.length && (
        <section className="mt-7">
          <SectionHeading>等待你确认</SectionHeading>
          <div className="divide-y rounded-lg border">
            {status.pending.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {p.ip} · 请核对连接发起方
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void action(() =>
                      call("lan_approve", { id: p.id, approve: false }),
                    )
                  }
                >
                  拒绝
                </Button>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void action(() =>
                      call("lan_approve", { id: p.id, approve: true }),
                    )
                  }
                >
                  允许配对
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="mt-8">
        <SectionHeading
          action={
            <Button
              size="sm"
              variant="outline"
              disabled={!desktop}
              onClick={() => setConnect(true)}
            >
              <Plus />
              连接设备
            </Button>
          }
        >
          连接到其他电脑
        </SectionHeading>
        <div className="divide-y rounded-lg border">
          {status?.peers.map((p) => {
            const remote = devices.find((d) => d.id === p.id);
            return (
              <div key={p.id} className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {remote?.snapshot?.name || p.name}
                    <span className="ml-3 text-xs font-normal text-muted-foreground">
                      {remote?.online ? "在线" : "未连接"}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {p.address}
                    {remote?.error && ` · ${remote.error}`}
                  </p>
                </div>
                <IconButton
                  label={`移除 ${p.name}`}
                  onClick={() =>
                    setConfirm({
                      command: "lan_forget",
                      id: p.id,
                      name: p.name,
                    })
                  }
                >
                  <Trash2 />
                </IconButton>
              </div>
            );
          })}
        </div>
        {!status?.peers.length && (
          <p className="py-4 text-sm text-muted-foreground">
            在另一台电脑开启共享，将配对码粘贴到这里。
          </p>
        )}
      </section>
      {!!status?.grants.length && (
        <section className="mt-8">
          <SectionHeading>允许访问本机的设备</SectionHeading>
          <div className="divide-y rounded-lg border">
            {status.grants.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between gap-4 p-4"
              >
                <div>
                  <p className="text-sm font-medium">{g.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {g.projects.length} 个项目 ·{" "}
                    {g.allowExecution ? "可执行任务" : "仅查看"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setConfirm({
                      command: "lan_revoke",
                      id: g.id,
                      name: g.name,
                    })
                  }
                >
                  撤销授权
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}
      <Dialog
        open={!!invite}
        onOpenChange={(v) => {
          if (!v) setInvite("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>配对本机</DialogTitle>
            <DialogDescription>
              在另一台 OiAgent 的「局域网连接 →
              连接设备」中粘贴。配对码包含校验证书，5
              分钟有效且仅可使用一次；本机确认后才授予访问权限。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="一次性配对码"
            readOnly
            value={invite}
            className="h-28 break-all font-mono text-xs"
          />
          <DialogFooter>
            <Button
              onClick={() =>
                void navigator.clipboard
                  .writeText(invite)
                  .then(() => toast.success("已复制配对码"))
                  .catch(() => toast.error("无法访问剪贴板"))
              }
            >
              <Copy />
              复制配对码
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={connect}
        onOpenChange={(v) => {
          if (!pending && !busy) setConnect(v);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>连接另一台 OiAgent</DialogTitle>
            <DialogDescription>
              {pending
                ? `已向 ${pending.invite.name} 发出请求，请在对方电脑上允许配对。`
                : "仅粘贴从可信电脑直接获取的配对码。连接时会校验证书，系统不会忽略证书错误。"}
            </DialogDescription>
          </DialogHeader>
          {!pending && (
            <>
              <Label htmlFor="client-name">让对方识别这台电脑的名称</Label>
              <Input
                id="client-name"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
              />
              <Label htmlFor="pair-code">配对码</Label>
              <Textarea
                id="pair-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="h-28 font-mono text-xs"
              />
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPending(undefined);
                setConnect(false);
              }}
            >
              取消
            </Button>
            {!pending && (
              <Button
                disabled={busy || !code.trim() || !clientName.trim()}
                onClick={() =>
                  void action(async () =>
                    setPending(
                      await call<PairRequest>("lan_pair_begin", {
                        invitation: code,
                        name: clientName,
                      }),
                    ),
                  )
                }
              >
                请求配对
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!confirm}
        onOpenChange={(v) => {
          if (!v) setConfirm(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.command === "lan_revoke" ? "撤销授权" : "移除连接"}：
              {confirm?.name}
            </DialogTitle>
            <DialogDescription>
              {confirm?.command === "lan_revoke"
                ? "立即拒绝此设备的新请求。已接受的任务仍在本机继续，可在任务列表中停止。"
                : "从本机删除连接凭据。远程任务会继续运行；如需撤销本机权限，请在对方电脑上操作。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(undefined)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  if (confirm) await call(confirm.command, { id: confirm.id });
                  setConfirm(undefined);
                })
              }
            >
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
