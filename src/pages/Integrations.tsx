import { McpEditor } from "@/components/workspace/McpEditor";
import { useEffect, useEffectEvent, useState } from "react";
import {
  Plus,
  FolderOpen,
  RefreshCw,
  Pencil,
  Trash2,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Choice,
  Empty,
  PageHeading,
  IconButton,
} from "@/components/workspace/shared";
import { call, desktop, pickDirectory } from "@/lib/api";
import { projectName, type Snapshot } from "@/lib/types";
import {
  integrationKinds,
  emptyRevision,
  mcpTemplate,
  type IntegrationView,
  type McpServer,
  type SkillEntry,
  type IntegrationScope,
  type IntegrationContext,
} from "@/lib/integrations";

export function IntegrationsPage({
  snapshot,
  initialKind,
  onBack,
  onEditSkill,
  context,
  onContextChange,
}: {
  snapshot: Snapshot;
  initialKind?: string;
  onBack: () => void;
  onEditSkill: (scope: IntegrationScope, skill: SkillEntry) => void;
  context?: IntegrationContext;
  onContextChange?: (context: IntegrationContext) => void;
}) {
  const agents = snapshot.agents.filter((a) => a.available);
  const [kind, setKind] = useState(
    context?.kind || initialKind || agents[0]?.kind || "claude",
  );
  const [project, setProject] = useState(context?.project || "user");
  const [tab, setTab] = useState(context?.tab || "mcp");
  const [description, setDescription] = useState("");
  const rememberContext = useEffectEvent(() =>
    onContextChange?.({ kind, project, tab }),
  );
  useEffect(() => {
    rememberContext();
  }, [kind, project, tab]);
  const [extraProject, setExtraProject] = useState("");
  const [view, setView] = useState<IntegrationView>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [server, setServer] = useState<McpServer | null>(null);
  const [skill, setSkill] = useState<SkillEntry | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [removingSkill, setRemovingSkill] = useState<SkillEntry>();
  const [removing, setRemoving] = useState<McpServer | null>(null);
  const scope = { kind, project: project === "user" ? null : project };
  const supported = integrationKinds.includes(kind);
  useEffect(() => {
    let cancelled = false;
    // Changing scope invalidates the old configuration before its asynchronous read.
    // oxlint-disable-next-line react/set-state-in-effect
    setView(undefined);
    setError("");
    if (!desktop || !supported) return;
    void call<IntegrationView>("integration_view", {
      scope: { kind, project: project === "user" ? null : project },
    })
      .then((v) => {
        if (!cancelled) setView(v);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [kind, project, supported, reload]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      setReload((n) => n + 1);
      toast.success("已保存，下次启动 Agent 时生效");
      return true;
    } catch (e) {
      toast.error(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function editServer(value?: McpServer) {
    const s = value || { name: "", config: mcpTemplate(kind, false) };
    setServer(s);
    setName(s.name);
    setContent(JSON.stringify(s.config, null, 2));
  }
  function editSkill(value?: SkillEntry) {
    if (value) {
      onEditSkill(scope, value);
      return;
    }
    setDescription("");
    const s = value || {
      id: "",
      name: "",
      description: "",
      path: "",
      revision: emptyRevision,
      content:
        "---\nname: my-skill\ndescription: 说明何时使用这个 Skill\n---\n\n在这里编写执行步骤。\n",
    };
    setSkill(s);
    setName(s.name);
    setContent(s.content);
  }
  const projects = [
    ...new Set([
      ...snapshot.projects,
      ...(project !== "user" ? [project] : []),
      ...(extraProject ? [extraProject] : []),
    ]),
  ];
  return (
    <div className="mx-auto w-full max-w-5xl p-5 lg:p-8">
      <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={onBack}>
        <ArrowLeft />
        返回 Agent 程序
      </Button>
      <PageHeading title="MCP 与 Skills">
        <Button
          variant="outline"
          disabled={!desktop || busy}
          onClick={() => setReload((n) => n + 1)}
        >
          <RefreshCw />
          刷新
        </Button>
      </PageHeading>
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <Label>Agent</Label>
          <Choice
            label="配置 Agent"
            value={kind}
            onChange={setKind}
            options={agents.map((a) => ({ value: a.kind, label: a.name }))}
          />
        </div>
        <div className="space-y-2">
          <Label>作用范围</Label>
          <Choice
            label="作用范围"
            value={project}
            onChange={setProject}
            options={[
              { value: "user", label: "用户 · 所有项目" },
              ...projects.map((p) => ({ value: p, label: projectName(p) })),
            ]}
          />
        </div>
        <Button
          variant="ghost"
          disabled={!desktop}
          onClick={async () => {
            try {
              const dir = await pickDirectory();
              if (dir) {
                setExtraProject(dir);
                setProject(dir);
              }
            } catch (e) {
              toast.error(String(e));
            }
          }}
        >
          <FolderOpen />
          选择项目
        </Button>
      </div>
      {!desktop ? (
        <Empty title="请在桌面版管理配置" />
      ) : !supported ? (
        <Empty
          title="该程序暂未适配原生 MCP / Skills 配置"
          description="目前支持 Codex、Claude Code、Qwen Code、Gemini CLI 和 OpenCode。"
        />
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : !view ? (
        <p className="text-sm text-muted-foreground">正在读取配置…</p>
      ) : (
        <>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-5">
              <TabsTrigger value="mcp">
                MCP 服务器 · {view.servers.length}
              </TabsTrigger>
              <TabsTrigger value="skills">
                Skills · {view.skills.length}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="mcp" className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <code
                  className="min-w-0 truncate text-xs text-muted-foreground"
                  title={view.configPath}
                >
                  {view.configPath}
                </code>
                <Button size="sm" onClick={() => editServer()}>
                  <Plus />
                  添加服务器
                </Button>
              </div>
              {!view.servers.length && (
                <Empty
                  title="尚未配置 MCP"
                  description="添加本地工具服务或远程 MCP 地址，供此 Agent 使用。"
                />
              )}
              <div className="divide-y rounded-lg border">
                {view.servers.map((s) => (
                  <div
                    key={s.name}
                    className="flex items-center gap-4 px-4 py-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {s.name}
                        {s.config.enabled === false && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            已停用
                          </span>
                        )}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {s.config.command ? "本地进程" : "远程服务"}
                      </p>
                    </div>
                    <IconButton
                      label={`编辑 ${s.name}`}
                      onClick={() => editServer(s)}
                    >
                      <Pencil />
                    </IconButton>
                    <IconButton
                      label={`移除 ${s.name}`}
                      onClick={() => setRemoving(s)}
                    >
                      <Trash2 />
                    </IconButton>
                  </div>
                ))}
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                仅保存配置，不会启动服务。首次使用前请在 Agent
                中确认工具权限；原配置会自动备份。
              </p>
            </TabsContent>
            <TabsContent value="skills" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <code
                  className="truncate text-xs text-muted-foreground"
                  title={view.skillsPath}
                >
                  {view.skillsPath}
                </code>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        const source = await pickDirectory();
                        if (source)
                          await action(() =>
                            call("integration_import_skill", { scope, source }),
                          );
                      } catch (e) {
                        toast.error(String(e));
                      }
                    }}
                  >
                    <FolderOpen />
                    导入文件夹
                  </Button>
                  <Button size="sm" onClick={() => editSkill()}>
                    <Plus />
                    新建 Skill
                  </Button>
                </div>
              </div>
              {!view.skills.length && (
                <Empty
                  title="还没有 Skills"
                  description="导入含 SKILL.md 的文件夹，或编写自己的操作指南。"
                />
              )}
              <div className="divide-y rounded-lg border">
                {view.skills.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 pr-3">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-4 px-4 py-4 text-left hover:bg-muted/50"
                      onClick={() => editSkill(s)}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{s.name}</p>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {s.description}
                        </p>
                      </div>
                      <Pencil className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                    <IconButton
                      label={`移除 Skill ${s.name}`}
                      disabled={busy}
                      onClick={() => setRemovingSkill(s)}
                    >
                      <Trash2 />
                    </IconButton>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                导入会保留附带脚本与资源；请仅使用可信来源的 Skills。
              </p>
            </TabsContent>
          </Tabs>
          {view.warnings.map((w) => (
            <p key={w} className="mt-4 break-all text-xs text-destructive">
              {w}
            </p>
          ))}
        </>
      )}
      <Dialog
        open={!!server || !!skill}
        onOpenChange={(v) => {
          if (!v && !busy) {
            setServer(null);
            setSkill(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {server
                ? server.name
                  ? "编辑 MCP 服务器"
                  : "添加 MCP 服务器"
                : "新建 Skill"}
            </DialogTitle>
            <DialogDescription>
              {server
                ? "填写此 Agent 的原生配置。额外字段会保留，JSONC 注释会在保存时格式化，原文保留在备份中。"
                : "创建后将在文件编辑标签中编写 SKILL.md。"}
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="integration-name">
            {server ? "服务器名称" : "文件夹名称"}
          </Label>
          <Input
            id="integration-name"
            value={name}
            disabled={!!server?.name || !!skill?.id}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-tool"
          />
          {server ? (
            <McpEditor kind={kind} value={content} onChange={setContent} />
          ) : (
            <>
              <Label htmlFor="skill-description">用途</Label>
              <Input
                id="skill-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="说明何时使用这个 Skill"
              />
            </>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setServer(null);
                setSkill(null);
              }}
            >
              取消
            </Button>
            <Button
              disabled={busy || (!name && !skill?.id)}
              onClick={async () => {
                const ok = await action(async () => {
                  if (
                    server &&
                    !server.name &&
                    view?.servers.some((s) => s.name === name)
                  )
                    throw new Error("同名 MCP 已存在，请编辑现有配置");
                  if (server)
                    await call("integration_save_mcp", {
                      scope,
                      name,
                      config: JSON.parse(content),
                      expected: view?.revision,
                    });
                  else if (skill) {
                    const body = `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description || "说明何时使用这个 Skill")}\n---\n\n在这里编写执行步骤。\n`;
                    const saved = await call<{
                      content: string;
                      revision: string;
                    }>("integration_save_skill", {
                      scope,
                      id: name,
                      content: body,
                      expected: emptyRevision,
                    });
                    onEditSkill(scope, {
                      id: name,
                      name,
                      description,
                      path: `${view!.skillsPath}/${name}/SKILL.md`,
                      ...saved,
                    });
                  }
                });
                if (ok) {
                  setServer(null);
                  setSkill(null);
                }
              }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!removing}
        onOpenChange={(v) => {
          if (!v) setRemoving(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>移除 {removing?.name}？</DialogTitle>
            <DialogDescription>
              移除此作用范围中的服务器配置。已有任务不受影响，原配置会自动备份。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (
                  await action(() =>
                    call("integration_save_mcp", {
                      scope,
                      name: removing?.name,
                      config: null,
                      expected: view?.revision,
                    }),
                  )
                )
                  setRemoving(null);
              }}
            >
              移除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!removingSkill}
        onOpenChange={(v) => {
          if (!v) setRemovingSkill(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>移除 {removingSkill?.name}？</DialogTitle>
            <DialogDescription>
              整个 Skill 文件夹将移到同级 oiagent-skill-backups 备份目录，Agent
              不再加载它。共享目录中的 Skill 也可能被其他 Agent 使用。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRemovingSkill(undefined)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (
                  removingSkill &&
                  (await action(() =>
                    call("integration_remove_skill", {
                      scope,
                      id: removingSkill.id,
                      expected: removingSkill.revision,
                    }),
                  ))
                ) {
                  setRemovingSkill(undefined);
                  setSkill(null);
                }
              }}
            >
              移除并备份
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
