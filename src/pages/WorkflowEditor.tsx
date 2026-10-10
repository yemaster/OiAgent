import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  Plus,
  Save,
  Play,
  WandSparkles,
  FolderOpen,
  LoaderCircle,
  PanelRight,
  X,
  CircleHelp,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Choice, IconButton } from "@/components/workspace/shared";
import { call, desktop, pickDirectory } from "@/lib/api";
import { WorkflowGraph } from "@/components/workflows/LazyWorkflowGraph";
import { WorkflowNodeSettings } from "@/components/workflows/WorkflowNodeSettings";
import {
  newStep,
  asGraph,
  layoutGraph,
  stepNames,
  validateWorkflow,
  type WorkflowDefinition,
  type WorkflowStep,
  type WorkflowEditor,
} from "@/lib/workflows";
import type { Snapshot, Task, TemporaryProject } from "@/lib/types";
export function WorkflowEditorPage({
  editor,
  snapshot,
  onChange,
  onSaved,
  onBack,
  onCreated,
  onSettings,
}: {
  editor: WorkflowEditor;
  snapshot: Snapshot;
  onChange: (id: string, patch: Partial<WorkflowEditor>) => void;
  onSaved: () => Promise<void>;
  onBack: () => void;
  onCreated: (task: Task) => void;
  onSettings: () => void;
}) {
  const definition = asGraph(editor.definition);
  const agents = useMemo(
    () => snapshot.agents.filter((a) => a.available && !a.custom),
    [snapshot.agents],
  );
  const [selectedId, setSelectedId] = useState(definition.steps[0]?.id);
  const [panel, setPanel] = useState("workflow");
  const [nodeSection, setNodeSection] = useState("content");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const goalInput = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState("");
  const lock = useRef(false);
  const [error, setError] = useState("");
  const selected =
    definition.steps.find((s) => s.id === selectedId) || definition.steps[0];
  function update(patch: Partial<WorkflowDefinition>) {
    onChange(editor.sessionId, { definition: { ...definition, ...patch } });
  }
  function selectNode(id: string) {
    if (id !== selected?.id) setNodeSection("content");
    setSelectedId(id);
    setPanel("node");
    setInspectorOpen(true);
  }
  function add(kind: WorkflowStep["kind"]) {
    const step = newStep("", kind);
    const placed = layoutGraph(definition).steps;
    const source =
      selected &&
      (selected.position || placed.find((s) => s.id === selected.id)?.position);
    step.position = {
      x: (source?.x ?? -280) + 280,
      y:
        (source?.y ?? 0) +
        (definition.edges?.filter((e) => e.source === selected?.id).length ??
          0) *
          192,
    };
    // A new regular node continues the selected path. Condition outlets are explicit.
    const edge =
      selected && selected.kind !== "condition"
        ? [{ id: crypto.randomUUID(), source: selected.id, target: step.id }]
        : [];
    update({
      steps: [...definition.steps, step],
      edges: [...definition.edges!, ...edge],
    });
    selectNode(step.id);
  }
  async function action(type: "save" | "generate" | "start") {
    if (lock.current) return;
    if (type === "generate" && !definition.goal.trim()) {
      setPanel("workflow");
      setInspectorOpen(true);
      requestAnimationFrame(() => goalInput.current?.focus());
      return;
    }
    if (type !== "generate") {
      const message = validateWorkflow(definition);
      if (message) {
        setError(message);
        setInspectorOpen(true);
        if (!definition.name.trim() || !definition.goal.trim()) {
          setPanel("workflow");
        } else {
          const incomplete = definition.steps.find(
            (step) => !step.title.trim() || !step.prompt.trim(),
          );
          if (incomplete) {
            selectNode(incomplete.id);
            setNodeSection("content");
          }
        }
        return;
      }
    }
    lock.current = true;
    setBusy(type);
    setError("");
    try {
      if (type === "generate") {
        const generated = await call<WorkflowDefinition>("generate_workflow", {
          goal: definition.goal,
          name: definition.name,
          defaultAgentId: definition.defaultAgentId || null,
        });
        // Write back to this editor session even if the user navigated to another page.
        onChange(editor.sessionId, {
          definition: {
            ...layoutGraph(asGraph(generated)),
            id: definition.id,
            revision: definition.revision,
            maxParallel: definition.maxParallel ?? 2,
          },
        });
        selectNode(generated.steps[0]?.id);
        toast.success("计划已生成，请检查步骤后启动");
      } else if (type === "save") {
        const saved = await call<WorkflowDefinition>("save_workflow", {
          definition,
        });
        onChange(editor.sessionId, { definition: saved });
        await onSaved();
        toast.success("工作流已保存");
      } else {
        let project = editor.project.trim();
        if (!project) {
          const allocated = await call<TemporaryProject>(
            "create_temporary_project",
          );
          project = allocated.path;
          onChange(editor.sessionId, { project });
        }
        const task = await call<Task>("start_workflow", {
          definition,
          project,
        });
        onCreated(task);
      }
    } catch (error) {
      setError(String(error));
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
      aria-label="工作流编辑器"
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <h1 className="sr-only">
          {definition.id ? "编辑工作流" : "新建工作流"}
        </h1>
        <IconButton label="返回" onClick={onBack}>
          <ArrowLeft />
        </IconButton>
        <Input
          aria-label="名称"
          value={definition.name}
          onChange={(e) => update({ name: e.target.value })}
          disabled={!!busy}
          placeholder="工作流名称"
          className="h-8 min-w-28 flex-1 border-transparent bg-transparent font-medium shadow-none hover:border-input focus-visible:border-input"
        />

        <Button
          size="sm"
          variant="outline"
          disabled={!!busy}
          onClick={() => void action("save")}
        >
          <Save />
          {busy === "save" ? "正在保存…" : "保存工作流"}
        </Button>
        <Button
          size="sm"
          disabled={!!busy || !desktop}
          onClick={() => void action("start")}
        >
          <Play />
          {busy === "start" ? "正在启动…" : "启动"}
        </Button>
      </header>
      {error && (
        <p
          role="alert"
          className="max-h-24 shrink-0 overflow-y-auto border-b bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <div className="@container relative flex min-h-0 flex-1 overflow-hidden">
        <section
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          aria-label="图编排"
        >
          <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!!busy || definition.steps.length >= 24}
                >
                  <Plus />
                  添加节点
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44">
                {(Object.keys(stepNames) as WorkflowStep["kind"][]).map(
                  (kind) => (
                    <DropdownMenuItem key={kind} onSelect={() => add(kind)}>
                      {stepNames[kind]}
                    </DropdownMenuItem>
                  ),
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="text-xs text-muted-foreground">
              {definition.steps.length} 个节点
            </span>
            <div className="ml-auto flex items-center gap-1">
              <IconButton
                label="从右侧出口拖向下一节点入口建立连接；点击节点编辑，点击连线可删除。"
                tooltipSide="bottom"
              >
                <CircleHelp />
              </IconButton>
              <Button
                size="sm"
                variant={inspectorOpen ? "secondary" : "ghost"}
                aria-expanded={inspectorOpen}
                aria-controls="workflow-inspector"
                onClick={() => setInspectorOpen(!inspectorOpen)}
              >
                <PanelRight />
                设置
              </Button>
            </div>
          </div>
          <WorkflowGraph
            definition={definition}
            agents={agents}
            selectedId={panel === "node" ? selected?.id : undefined}
            onSelect={selectNode}
            onChange={update}
            disabled={!!busy}
            className="h-full min-h-0 flex-1 rounded-none border-0"
          />
        </section>
        {inspectorOpen && (
          <aside
            id="workflow-inspector"
            aria-label="工作流设置面板"
            className="absolute inset-y-0 right-0 z-10 flex w-full max-w-[360px] flex-col border-l bg-background shadow-sm @3xl:static @3xl:w-[360px] @3xl:shrink-0 @3xl:shadow-none animate-in fade-in-0 slide-in-from-right-2 duration-150 motion-reduce:animate-none"
          >
            <Tabs
              value={panel}
              onValueChange={setPanel}
              className="min-h-0 flex-1 gap-0"
            >
              <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
                <TabsList variant="line" className="mr-auto">
                  <TabsTrigger value="workflow">工作流</TabsTrigger>
                  <TabsTrigger value="node" disabled={!selected}>
                    节点
                  </TabsTrigger>
                </TabsList>
                <IconButton
                  label="收起设置"
                  onClick={() => setInspectorOpen(false)}
                >
                  <X />
                </IconButton>
              </div>
              <TabsContent
                value="workflow"
                className="min-h-0 overflow-y-auto overscroll-contain p-4"
              >
                <fieldset
                  disabled={!!busy}
                  className="min-w-0 space-y-5 disabled:opacity-70"
                >
                  <div className="space-y-2">
                    <Label htmlFor="workflow-goal">任务目标</Label>
                    <Textarea
                      id="workflow-goal"
                      ref={goalInput}
                      className="h-32 min-h-24 max-h-64 resize-y field-sizing-fixed"
                      value={definition.goal}
                      onChange={(e) => update({ goal: e.target.value })}
                      placeholder="说明要完成的工作、约束和验收要求"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!!busy || !desktop}
                            onClick={() => void action("generate")}
                          >
                            {busy === "generate" ? (
                              <LoaderCircle className="animate-spin" />
                            ) : (
                              <WandSparkles />
                            )}
                            生成计划
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          根据任务目标生成并替换当前节点，生成后可继续编辑。
                        </TooltipContent>
                      </Tooltip>
                      <Button size="sm" variant="ghost" onClick={onSettings}>
                        LLM API 设置
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="workflow-project">项目目录（可选）</Label>
                    <div className="flex gap-2">
                      <Input
                        id="workflow-project"
                        value={editor.project}
                        onChange={(e) =>
                          onChange(editor.sessionId, {
                            project: e.target.value,
                          })
                        }
                        placeholder="留空使用临时项目"
                      />
                      <IconButton
                        label="选择工作流项目"
                        onClick={() =>
                          void pickDirectory()
                            .then((project) => {
                              if (project)
                                onChange(editor.sessionId, { project });
                            })
                            .catch((e) => toast.error(String(e)))
                        }
                      >
                        <FolderOpen />
                      </IconButton>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>默认 Agent</Label>
                    <Choice
                      className="w-full min-w-0"
                      label="工作流默认 Agent"
                      value={definition.defaultAgentId || "unset"}
                      onChange={(defaultAgentId) =>
                        update({
                          defaultAgentId:
                            defaultAgentId === "unset" ? "" : defaultAgentId,
                          steps: definition.steps.map((s) =>
                            !s.agentId
                              ? { ...s, model: "", providerId: null }
                              : s,
                          ),
                        })
                      }
                      options={[
                        { value: "unset", label: "选择 Agent" },
                        ...agents.map((a) => ({ value: a.id, label: a.name })),
                        ...(definition.defaultAgentId &&
                        !agents.some((a) => a.id === definition.defaultAgentId)
                          ? [
                              {
                                value: definition.defaultAgentId,
                                label: `${definition.defaultAgentId}（不可用）`,
                              },
                            ]
                          : []),
                      ]}
                    />
                  </div>

                  <details className="space-y-4 border-t pt-4 text-sm">
                    <summary className="cursor-pointer text-muted-foreground">
                      运行选项
                    </summary>
                    <div className="space-y-2">
                      <Label>最多同时执行</Label>
                      <Choice
                        className="w-full min-w-0"
                        label="最大并行数"
                        value={String(definition.maxParallel ?? 2)}
                        onChange={(value) =>
                          update({ maxParallel: Number(value) })
                        }
                        options={[1, 2, 3, 4].map((n) => ({
                          value: String(n),
                          label: `${n} 个节点`,
                        }))}
                      />
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      修改项目的任务依次执行。
                    </p>
                  </details>
                </fieldset>
              </TabsContent>
              <TabsContent
                value="node"
                className="flex min-h-0 flex-col overflow-hidden data-[state=inactive]:hidden"
              >
                {selected && (
                  <WorkflowNodeSettings
                    key={selected.id}
                    definition={definition}
                    selected={selected}
                    agents={agents}
                    profiles={snapshot.providers || []}
                    disabled={!!busy}
                    section={nodeSection}
                    onSectionChange={setNodeSection}
                    onChange={update}
                    onSelect={selectNode}
                    onError={setError}
                  />
                )}
              </TabsContent>
            </Tabs>
          </aside>
        )}
      </div>
      {!desktop && (
        <p className="shrink-0 border-t px-4 py-1.5 text-xs text-muted-foreground">
          浏览器中可编辑和保存，生成与执行需要桌面版。
        </p>
      )}
    </div>
  );
}
