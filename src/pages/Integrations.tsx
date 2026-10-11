import { McpEditor } from "@/components/workspace/McpEditor";
import { useEffect, useEffectEvent, useState } from "react";
import {
  Plus,
  FolderOpen,
  RefreshCw,
  Pencil,
  Trash2,
  ArrowLeft,
  MoreHorizontal,
  Copy,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
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
  const [search, setSearch] = useState({ mcp: "", skills: "" });
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
      toast.success("已保存");
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
  async function saveEditor() {
    const ok = await action(async () => {
      if (server && !server.name && view?.servers.some((s) => s.name === name))
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
        const saved = await call<{ content: string; revision: string }>(
          "integration_save_skill",
          { scope, id: name, content: body, expected: emptyRevision },
        );
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
  }
  function closeEditor() {
    if (!busy) {
      setServer(null);
      setSkill(null);
    }
  }
  async function importSkill() {
    try {
      const source = await pickDirectory();
      if (source)
        await action(() => call("integration_import_skill", { scope, source }));
    } catch (e) {
      toast.error(String(e));
    }
  }
  async function copyPath() {
    try {
      await navigator.clipboard.writeText(
        tab === "mcp" ? view!.configPath : view!.skillsPath,
      );
      toast.success("已复制路径");
    } catch (e) {
      toast.error(String(e));
    }
  }
  const activeTab = tab === "skills" ? "skills" : "mcp";
  const query = search[activeTab].trim().toLocaleLowerCase();
  const servers =
    view?.servers.filter((s) => s.name.toLocaleLowerCase().includes(query)) ||
    [];
  const skills =
    view?.skills.filter((s) =>
      `${s.name} ${s.description}`.toLocaleLowerCase().includes(query),
    ) || [];
  if (server || skill)
    return (
      <div className="mx-auto w-full max-w-3xl p-5 lg:p-8">
        <div className="mb-6 flex items-center gap-3">
          <IconButton
            label={server ? "返回 MCP 服务器" : "返回 Skills"}
            disabled={busy}
            onClick={closeEditor}
          >
            <ArrowLeft />
          </IconButton>
          <h1 className="text-xl font-semibold">
            {server
              ? server.name
                ? "编辑 MCP 服务器"
                : "添加 MCP 服务器"
              : "新建 Skill"}
          </h1>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && name.trim()) void saveEditor();
          }}
          className="space-y-6"
        >
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>{agents.find((a) => a.kind === kind)?.name || kind}</span>
            <span>·</span>
            <span title={project}>
              {project === "user" ? "所有项目" : projectName(project)}
            </span>
          </div>
          <div className="space-y-2">
            <Label htmlFor="integration-name">
              {server ? "服务器名称" : "文件夹名称"}
            </Label>
            <Input
              id="integration-name"
              value={name}
              disabled={busy || !!server?.name || !!skill?.id}
              onChange={(e) => setName(e.target.value)}
              placeholder={server ? "my-server" : "my-skill"}
            />
          </div>
          <fieldset disabled={busy} className="min-w-0">
            {server ? (
              <McpEditor kind={kind} value={content} onChange={setContent} />
            ) : (
              <div className="space-y-2">
                <Label htmlFor="skill-description">用途</Label>
                <Input
                  id="skill-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="这个 Skill 用于什么任务"
                />
              </div>
            )}
          </fieldset>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={closeEditor}
            >
              取消
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? "保存中…" : server ? "保存" : "创建并编辑"}
            </Button>
          </div>
        </form>
      </div>
    );
  return (
    <div className="mx-auto w-full max-w-5xl p-5 lg:p-8">
      <PageHeading title="MCP 与 Skills">
        <IconButton
          label="刷新配置"
          disabled={!desktop || busy}
          onClick={() => setReload((n) => n + 1)}
        >
          <RefreshCw />
        </IconButton>
      </PageHeading>
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Agent</Label>
          <Choice
            label="配置 Agent"
            value={kind}
            onChange={setKind}
            options={Array.from(
              new Map(
                agents.map((a) => [a.kind, { value: a.kind, label: a.name }]),
              ).values(),
            )}
            className="w-full"
          />
        </div>
        <div className="space-y-2">
          <Label>作用范围</Label>
          <div className="flex gap-2">
            <Choice
              label="作用范围"
              value={project}
              onChange={setProject}
              options={[
                { value: "user", label: "所有项目" },
                ...projects.map((p) => ({ value: p, label: projectName(p) })),
              ]}
              className="min-w-0 flex-1"
            />
            <IconButton
              label="选择项目"
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
            </IconButton>
          </div>
        </div>
      </div>
      {!desktop ? (
        <Empty title="请在桌面版管理配置" />
      ) : !supported ? (
        <Empty title="该 Agent 暂不支持配置管理" />
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : !view ? (
        <p className="text-sm text-muted-foreground">正在读取配置…</p>
      ) : (
        <>
          <Tabs value={activeTab} onValueChange={setTab} className="gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <TabsList>
                <TabsTrigger value="mcp">
                  MCP 服务器 · {view.servers.length}
                </TabsTrigger>
                <TabsTrigger value="skills">
                  Skills · {view.skills.length}
                </TabsTrigger>
              </TabsList>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    activeTab === "mcp" ? editServer() : editSkill()
                  }
                >
                  <Plus />
                  {activeTab === "mcp" ? "添加服务器" : "新建 Skill"}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={
                        activeTab === "mcp" ? "MCP 列表操作" : "Skills 列表操作"
                      }
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {activeTab === "skills" && (
                      <>
                        <DropdownMenuItem
                          disabled={busy}
                          onSelect={() => void importSkill()}
                        >
                          <FolderOpen />
                          导入文件夹
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuItem onSelect={() => void copyPath()}>
                      <Copy />
                      {activeTab === "mcp"
                        ? "复制配置路径"
                        : "复制 Skills 路径"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                aria-label={
                  activeTab === "mcp" ? "搜索 MCP 服务器" : "搜索 Skills"
                }
                placeholder={
                  activeTab === "mcp" ? "搜索服务器…" : "搜索 Skills…"
                }
                value={search[activeTab]}
                onChange={(e) =>
                  setSearch((prev) => ({
                    ...prev,
                    [activeTab]: e.target.value,
                  }))
                }
                className="pl-9"
              />
            </div>
            <TabsContent value="mcp">
              {servers.length ? (
                <div className="divide-y overflow-hidden rounded-lg border">
                  {servers.map((s) => (
                    <IntegrationRow
                      key={s.name}
                      name={s.name}
                      description={s.config.command ? "本地进程" : "远程服务"}
                      disabled={busy}
                      inactive={s.config.enabled === false}
                      onEdit={() => editServer(s)}
                      onRemove={() => setRemoving(s)}
                    />
                  ))}
                </div>
              ) : (
                <Empty
                  title={query ? "没有匹配的服务器" : "尚未添加 MCP 服务器"}
                />
              )}
            </TabsContent>
            <TabsContent value="skills">
              {skills.length ? (
                <div className="divide-y overflow-hidden rounded-lg border">
                  {skills.map((s) => (
                    <IntegrationRow
                      key={s.id}
                      name={s.name}
                      description={s.description}
                      disabled={busy}
                      onEdit={() => editSkill(s)}
                      onRemove={() => setRemovingSkill(s)}
                    />
                  ))}
                </div>
              ) : (
                <Empty title={query ? "没有匹配的 Skill" : "尚未添加 Skills"} />
              )}
            </TabsContent>
          </Tabs>
          {!!view.warnings.length && (
            <details className="mt-4 text-xs text-destructive">
              <summary className="cursor-pointer">
                {view.warnings.length} 项配置问题
              </summary>
              <ul className="mt-2 space-y-2">
                {view.warnings.map((w) => (
                  <li key={w} className="break-all">
                    {w}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <Dialog
        open={!!removing}
        onOpenChange={(v) => {
          if (!v) setRemoving(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>移除 {removing?.name}？</DialogTitle>
            <DialogDescription>配置将移除并备份。</DialogDescription>
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
              文件夹将移至备份目录。使用此 Skill 的其他 Agent 也会受影响。
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

function IntegrationRow({
  name,
  description,
  inactive,
  disabled,
  onEdit,
  onRemove,
}: {
  name: string;
  description: string;
  inactive?: boolean;
  disabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 pr-3">
      <Button
        variant="ghost"
        disabled={disabled}
        onClick={onEdit}
        aria-label={`${name} ${description}`.trim()}
        className="h-auto min-w-0 flex-1 justify-start rounded-none px-4 py-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{name}</span>
          {description && (
            <span className="mt-1 block truncate text-xs font-normal text-muted-foreground">
              {description}
            </span>
          )}
        </span>
      </Button>
      {inactive && <Badge variant="secondary">已停用</Badge>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`${name} 操作`}
            disabled={disabled}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil />
            编辑
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onRemove}>
            <Trash2 />
            移除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
