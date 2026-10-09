import { agentCatalog } from "@/lib/agents";
import { useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  Blocks,
  KeyRound,
  Plus,
  RefreshCw,
  Check,
  FolderOpen,
  Pencil,
  Trash2,
  FileJson,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AgentIcon,
  PageHeading,
  SectionHeading,
  IconButton,
} from "@/components/workspace/shared";
import { call, desktop } from "@/lib/api";
import type { Agent, Snapshot } from "@/lib/types";
const manifestExample = JSON.stringify(
  {
    schemaVersion: 1,
    type: "agent",
    name: "My Agent",
    executable: "/absolute/path/to/agent",
    args: ["--prompt", "{prompt}"],
    description: "通过标准输出返回执行记录",
  },
  null,
  2,
);
export function AgentsPage({
  snapshot,
  onRefresh,
  plugins = false,
  onBack,
  onClaudeApi,
  onIntegrations,
  onInstructions,
}: {
  snapshot: Snapshot;
  onRefresh: (scan?: boolean) => Promise<void>;
  plugins?: boolean;
  onBack?: () => void;
  onClaudeApi?: () => void;
  onInstructions?: (kind: string) => void;
  onIntegrations?: (kind: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [name, setName] = useState("");
  const [exe, setExe] = useState("");
  const [args, setArgs] = useState('["{prompt}"]');
  const [busy, setBusy] = useState(false);
  const [manifest, setManifest] = useState(manifestExample);
  const [importing, setImporting] = useState(false);
  function edit(a?: Agent) {
    setEditing(a || null);
    setName(a?.name || "");
    setExe(a?.executable || "");
    setArgs(JSON.stringify(a?.args || ["{prompt}"], null, 2));
    setOpen(true);
  }
  async function save() {
    setBusy(true);
    try {
      const parsed: unknown = JSON.parse(args);
      if (!Array.isArray(parsed) || parsed.some((x) => typeof x !== "string"))
        throw new Error("启动参数必须是字符串数组");
      await call("save_agent", {
        agent: {
          id: editing?.id || "",
          name,
          executable: exe,
          args: parsed,
          kind: "custom",
          custom: true,
          available: false,
          version: "",
        },
      });
      await onRefresh();
      setOpen(false);
      toast.success("Agent 已保存");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function scan() {
    setBusy(true);
    try {
      await onRefresh(true);
      toast.success("扫描完成");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function install() {
    setBusy(true);
    try {
      JSON.parse(manifest);
      await call("import_plugin", { manifest });
      await onRefresh();
      setImporting(false);
      toast.success("插件已添加");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }
  const agents = plugins
    ? snapshot.agents.filter((a) => a.custom)
    : snapshot.agents;
  const installed = agents.filter((a) => a.available);
  const missing = agents.filter((a) => !a.available);
  const renderAgent = (a: Agent) => {
    const actions: {
      label: string;
      icon: typeof FileText;
      onClick: () => void;
    }[] = [];
    if (
      a.available &&
      onInstructions &&
      ["codex", "claude", "qwen", "gemini", "opencode"].includes(a.kind)
    ) {
      actions.push({
        label: "指令文件",
        icon: FileText,
        onClick: () => onInstructions(a.kind),
      });
    }
    if (a.available && onIntegrations) {
      actions.push({
        label: "MCP 与 Skills",
        icon: Blocks,
        onClick: () => onIntegrations(a.kind),
      });
    }
    if (a.kind === "claude" && onClaudeApi) {
      actions.push({
        label: "Claude Code API 配置",
        icon: KeyRound,
        onClick: onClaudeApi,
      });
    }
    return (
      <Card key={a.id} className="min-w-0 gap-0 rounded-lg py-0 shadow-none">
        <CardContent className="flex-1 p-5">
          <div className="mb-5 flex items-center gap-3">
            <AgentIcon kind={a.kind} className="size-10 shrink-0" />
            <div className="min-w-0 flex-1">
              <h2 className="break-words text-sm font-semibold">{a.name}</h2>
              <p
                className="mt-1 truncate text-xs text-muted-foreground"
                title={a.version}
              >
                {a.custom ? "自定义程序" : a.version || "尚未安装"}
              </p>
            </div>
            <Badge
              variant="secondary"
              className={
                a.available
                  ? "bg-transparent text-muted-foreground [&_svg]:text-emerald-600"
                  : ""
              }
            >
              {a.available ? (
                <>
                  <Check className="size-3" />
                  已就绪
                </>
              ) : (
                "未检测到"
              )}
            </Badge>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2.5 text-xs text-muted-foreground">
            <FolderOpen className="size-3.5 shrink-0" />
            <code className="truncate" title={a.executable}>
              {a.executable}
            </code>
          </div>
          {!a.custom && !agentCatalog[a.kind]?.history && (
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              在 OiAgent 中启动的任务会保存记录；暂不导入此程序已有的外部历史。
              {!agentCatalog[a.kind]?.structured &&
                " 输出以文本显示，Token 用量未接入。"}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="font-normal">
                {agentCatalog[a.kind]?.structured ? "结构化对话" : "命令任务"}
              </Badge>
              {agentCatalog[a.kind]?.history && (
                <Badge variant="outline" className="font-normal">
                  历史导入
                </Badge>
              )}
            </div>
            {a.custom && (
              <div className="flex gap-1">
                <IconButton label={`编辑 ${a.name}`} onClick={() => edit(a)}>
                  <Pencil />
                </IconButton>
                <IconButton
                  label={`移除 ${a.name}`}
                  onClick={async () => {
                    try {
                      await call("remove_agent", { id: a.id });
                      await onRefresh();
                      toast.success("已移除程序配置");
                    } catch (e) {
                      toast.error(String(e));
                    }
                  }}
                >
                  <Trash2 />
                </IconButton>
              </div>
            )}
          </div>
        </CardContent>
        {actions.length > 0 && (
          <CardFooter className="block bg-transparent p-2">
            <nav aria-label={`${a.name} 配置`} className="space-y-1">
              {actions.map(({ label, icon: Icon, onClick }) => (
                <Button
                  key={label}
                  variant="ghost"
                  size="sm"
                  className="h-auto min-h-9 w-full justify-start gap-3 whitespace-normal px-3 py-2 font-normal"
                  onClick={onClick}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 text-left">{label}</span>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                </Button>
              ))}
            </nav>
          </CardFooter>
        )}
      </Card>
    );
  };
  return (
    <div className="mx-auto w-full max-w-6xl p-5 lg:p-8">
      {onBack && (
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 -ml-2"
          onClick={onBack}
        >
          <ArrowLeft />
          返回新建任务
        </Button>
      )}
      <PageHeading title={plugins ? "插件" : "Agent 程序"}>
        <Button variant="outline" disabled={busy} onClick={() => void scan()}>
          <RefreshCw className={busy ? "animate-spin" : ""} />
          重新扫描
        </Button>
        <Button onClick={() => (plugins ? setImporting(true) : edit())}>
          <Plus />
          {plugins ? "导入插件" : "添加 Agent"}
        </Button>
      </PageHeading>
      <SectionHeading count={installed.length}>
        {plugins ? "可用插件" : "已安装"}
      </SectionHeading>
      <div className="grid gap-4 min-[1200px]:grid-cols-2">
        {installed.map(renderAgent)}
      </div>
      {!installed.length && (
        <p className="rounded-lg bg-muted/50 p-6 text-sm text-muted-foreground">
          暂未找到可用程序，可重新扫描或手动添加。
        </p>
      )}
      {missing.length > 0 && (
        <details className="mt-6 border-t pt-4">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            未检测到的程序 · {missing.length}
          </summary>
          <div className="mt-4 grid gap-4 min-[1200px]:grid-cols-2">
            {missing.map(renderAgent)}
          </div>
        </details>
      )}

      {plugins && (
        <div className="mt-7">
          {!agents.length && (
            <div className="rounded-lg bg-muted/50 p-6 text-center">
              <p className="text-sm font-medium">还没有安装插件</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                导入命令型插件后，就能在新建任务中选择它。
              </p>
            </div>
          )}
          <details className="mt-6 border-t pt-4">
            <summary className="cursor-pointer text-sm font-medium">
              开发一个插件
            </summary>
            <p className="my-4 text-xs leading-6 text-muted-foreground">
              用 JSON
              声明程序路径和启动参数，即可接入任务列表、实时输出、停止操作与历史记录。插件与本机
              CLI 使用相同的执行环境。
            </p>
            <pre className="overflow-auto rounded-md bg-muted p-4 text-xs leading-6">
              {manifestExample}
            </pre>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => setImporting(true)}
            >
              <FileJson />
              粘贴插件配置
            </Button>
          </details>
        </div>
      )}
      {!plugins && (
        <details className="mt-7 border-t pt-4">
          <summary className="cursor-pointer text-sm font-medium">
            没有找到已安装的程序？
          </summary>
          <p className="mt-3 text-xs leading-6 text-muted-foreground">
            自动检查 PATH、Homebrew、NVM
            和用户程序目录。安装后点「重新扫描」，仍未发现时可通过「添加
            Agent」指定程序路径。登录和模型设置沿用原有 CLI 配置。
          </p>
        </details>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "编辑 Agent" : "添加 Agent"}</DialogTitle>
            <DialogDescription>指定本机可执行程序及参数。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="agent-name">名称</Label>
              <Input
                id="agent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Agent"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-exe">程序路径或命令</Label>
              <Input
                id="agent-exe"
                value={exe}
                onChange={(e) => setExe(e.target.value)}
                placeholder="/usr/local/bin/my-agent"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-args">启动参数（JSON 数组）</Label>
              <Textarea
                id="agent-args"
                className="min-h-28 font-mono text-xs"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {"{prompt}"} 插入任务内容，{"{project}"} 插入项目目录。
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              disabled={busy || !name || !exe || !desktop}
              onClick={() => void save()}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={importing} onOpenChange={setImporting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>导入插件</DialogTitle>
            <DialogDescription>
              检查程序路径和启动参数，导入后将在新建任务中可选。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="插件 JSON"
            className="min-h-72 font-mono text-xs leading-6"
            value={manifest}
            onChange={(e) => setManifest(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setImporting(false)}>
              取消
            </Button>
            <Button disabled={busy || !desktop} onClick={() => void install()}>
              导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
