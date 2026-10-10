import { useRef, useState } from "react";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  Play,
  WandSparkles,
  FolderOpen,
  LoaderCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Choice, IconButton, PageHeading } from "@/components/workspace/shared";
import { call, desktop, pickDirectory } from "@/lib/api";
import { WorkflowGraph } from "@/components/workflows/LazyWorkflowGraph";
import {
  newStep,
  asGraph,
  layoutGraph,
  repairSource,
  stepNames,
  validateWorkflow,
  validateGraph,
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
  const agents = snapshot.agents.filter((a) => a.available && !a.custom);
  const [selectedId, setSelectedId] = useState(definition.steps[0]?.id);
  const [busy, setBusy] = useState("");
  const lock = useRef(false);
  const [error, setError] = useState("");
  const selected =
    definition.steps.find((s) => s.id === selectedId) || definition.steps[0];
  const index = selected
    ? definition.steps.findIndex((s) => s.id === selected.id)
    : -1;
  const agent = agents.find(
    (a) => a.id === (selected?.agentId || definition.defaultAgentId),
  );
  function update(patch: Partial<WorkflowDefinition>) {
    onChange(editor.sessionId, { definition: { ...definition, ...patch } });
  }
  function updateStep(patch: Partial<WorkflowStep>) {
    update({
      steps: definition.steps.map((s) =>
        s.id === selected.id ? { ...s, ...patch } : s,
      ),
    });
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
    setSelectedId(step.id);
  }
  async function action(type: "save" | "generate" | "start") {
    if (lock.current) return;
    if (type !== "generate") {
      const message = validateWorkflow(definition);
      if (message) {
        setError(message);
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
        setSelectedId(generated.steps[0]?.id);
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
    <div className="mx-auto max-w-[1600px] space-y-5 p-5 sm:p-8">
      <PageHeading title={definition.id ? "编辑工作流" : "新建工作流"}>
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft />
          返回
        </Button>
        <Button
          variant="outline"
          disabled={!!busy}
          onClick={() => void action("save")}
        >
          <Save />
          {busy === "save" ? "正在保存…" : "保存工作流"}
        </Button>
        <Button
          disabled={!!busy || !desktop}
          onClick={() => void action("start")}
        >
          <Play />
          {busy === "start" ? "正在启动…" : "启动"}
        </Button>
      </PageHeading>
      {error && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <fieldset disabled={!!busy} className="space-y-5 disabled:opacity-70">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="workflow-name">名称</Label>
            <Input
              id="workflow-name"
              value={definition.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="例如：检查并修复测试失败"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="workflow-project">项目目录（可选）</Label>
            <div className="flex gap-2">
              <Input
                id="workflow-project"
                value={editor.project}
                onChange={(e) =>
                  onChange(editor.sessionId, { project: e.target.value })
                }
                placeholder="留空使用临时项目"
              />
              <IconButton
                label="选择工作流项目"
                onClick={() =>
                  void pickDirectory()
                    .then((project) => {
                      if (project) onChange(editor.sessionId, { project });
                    })
                    .catch((e) => toast.error(String(e)))
                }
              >
                <FolderOpen />
              </IconButton>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="workflow-goal">任务目标</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onSettings}
              >
                LLM API 设置
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!definition.goal.trim() || !desktop}
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
                <TooltipContent side="bottom">
                  使用 LLM API 生成并替换下方步骤；确认启动前不会执行。
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
          <Textarea
            id="workflow-goal"
            className="min-h-24"
            value={definition.goal}
            onChange={(e) => update({ goal: e.target.value })}
            placeholder="说明要完成的工作、约束和验收要求"
          />
        </div>
        <div className="flex flex-wrap items-end gap-4 rounded-lg border bg-card p-4">
          <div className="min-w-52 space-y-2">
            <Label>默认 Agent</Label>
            <Choice
              label="工作流默认 Agent"
              value={definition.defaultAgentId || "unset"}
              onChange={(defaultAgentId) =>
                update({
                  defaultAgentId:
                    defaultAgentId === "unset" ? "" : defaultAgentId,
                  steps: definition.steps.map((s) =>
                    !s.agentId ? { ...s, model: "", providerId: null } : s,
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
          <div className="space-y-2">
            <Label>最多同时执行</Label>
            <Choice
              label="最大并行数"
              value={String(definition.maxParallel ?? 2)}
              onChange={(value) => update({ maxParallel: Number(value) })}
              options={[1, 2, 3, 4].map((n) => ({
                value: String(n),
                label: `${n} 个节点`,
              }))}
            />
          </div>
          <p className="pb-2 text-xs text-muted-foreground">
            节点默认沿用此 Agent；修改项目的任务依次执行。
          </p>
        </div>
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-1">
              {(Object.keys(stepNames) as WorkflowStep["kind"][]).map(
                (kind) => (
                  <Button
                    key={kind}
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={definition.steps.length >= 24}
                    onClick={() => add(kind)}
                  >
                    <Plus />
                    {stepNames[kind]}
                  </Button>
                ),
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {definition.steps.length} / 24
              </span>
            </div>
            <WorkflowGraph
              definition={definition}
              agents={agents}
              selectedId={selected?.id}
              onSelect={setSelectedId}
              onChange={update}
              disabled={!!busy}
            />
            <p className="text-xs leading-5 text-muted-foreground">
              从节点右侧拖向另一节点左侧建立连接。多个前置节点结束后汇合；未选中的分支会跳过。点击节点设置内容，点击连线可删除。
            </p>
          </section>
          {selected && (
            <section
              className="min-w-0 space-y-4 rounded-lg border bg-card p-4 sm:p-5"
              aria-label="步骤设置"
            >
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Choice
                    label="选中节点"
                    value={selected.id}
                    onChange={setSelectedId}
                    options={definition.steps.map((s) => ({
                      value: s.id,
                      label: s.title || "未命名节点",
                    }))}
                  />
                </div>
                <IconButton
                  label="删除步骤"
                  disabled={definition.steps.length <= 1}
                  onClick={() => {
                    const steps = definition.steps.filter(
                      (s) => s.id !== selected.id,
                    );
                    update({
                      steps,
                      edges: definition.edges!.filter(
                        (e) =>
                          e.source !== selected.id && e.target !== selected.id,
                      ),
                    });
                    setSelectedId(steps[Math.min(index, steps.length - 1)]?.id);
                  }}
                >
                  <Trash2 />
                </IconButton>
              </div>
              <div className="grid gap-4 2xl:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="workflow-step-name">步骤名称</Label>
                  <Input
                    id="workflow-step-name"
                    value={selected.title}
                    onChange={(e) => updateStep({ title: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>类型</Label>
                  <Choice
                    label="步骤类型"
                    value={selected.kind}
                    onChange={(kind) =>
                      update({
                        steps: definition.steps.map((s) =>
                          s.id === selected.id
                            ? {
                                ...s,
                                kind: kind as WorkflowStep["kind"],
                                maxRepairs: 0,
                              }
                            : s,
                        ),
                        edges: definition.edges!.filter(
                          (e) =>
                            e.source !== selected.id ||
                            (selected.kind !== "condition" &&
                              kind !== "condition"),
                        ),
                      })
                    }
                    options={Object.entries(stepNames).map(
                      ([value, label]) => ({ value, label }),
                    )}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="workflow-step-prompt">
                  {selected.kind === "agent"
                    ? "任务内容"
                    : selected.kind === "approval"
                      ? "需要确认的事项"
                      : selected.kind === "condition"
                        ? "判断条件（是 / 否）"
                        : "检查标准"}
                </Label>
                <Textarea
                  id="workflow-step-prompt"
                  className="min-h-40"
                  value={selected.prompt}
                  onChange={(e) => updateStep({ prompt: e.target.value })}
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  {selected.kind === "agent"
                    ? "执行时会附带任务目标、前序步骤结果和用户补充。"
                    : selected.kind === "approval"
                      ? "此路径等待人工确认，其他独立路径继续执行。"
                      : selected.kind === "condition"
                        ? "LLM 根据前置结果判断条件，选择“是”或“否”路径。证据不足时暂停，不猜测。"
                        : "LLM 对照前置节点的输出检查结果；不会自行读取文件或执行测试。"}
                </p>
              </div>
              {selected.kind === "agent" && (
                <>
                  <div className="grid gap-4 2xl:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Agent 程序</Label>
                      <Choice
                        label="步骤 Agent"
                        value={selected.agentId || "inherit"}
                        onChange={(agentId) =>
                          updateStep({
                            agentId: agentId === "inherit" ? "" : agentId,
                            model: "",
                            providerId: null,
                          })
                        }
                        options={[
                          { value: "inherit", label: "使用工作流默认 Agent" },
                          ...agents.map((a) => ({
                            value: a.id,
                            label: a.name,
                          })),
                          ...(!agents.some((a) => a.id === selected.agentId) &&
                          selected.agentId
                            ? [
                                {
                                  value: selected.agentId,
                                  label: `${selected.agentId}（不可用）`,
                                },
                              ]
                            : []),
                        ]}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>执行权限</Label>
                      <Choice
                        label="步骤执行权限"
                        value={selected.permission}
                        onChange={(permission) => updateStep({ permission })}
                        options={[
                          { value: "read-only", label: "只读 / 计划" },
                          { value: "workspace-write", label: "允许修改项目" },
                        ]}
                      />
                    </div>
                  </div>
                  <details className="space-y-4 text-sm">
                    <summary className="cursor-pointer text-muted-foreground">
                      模型、API 与执行时限
                    </summary>
                    <div className="grid gap-4 2xl:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="workflow-step-model">
                          模型（可选）
                        </Label>
                        <Input
                          id="workflow-step-model"
                          value={selected.model}
                          onChange={(e) =>
                            updateStep({ model: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="workflow-step-timeout">
                          执行时限（分钟，可选）
                        </Label>
                        <Input
                          id="workflow-step-timeout"
                          type="number"
                          min={1}
                          max={4294967295}
                          step={1}
                          placeholder="不限制"
                          value={selected.executionTimeoutMinutes ?? ""}
                          onChange={(e) =>
                            updateStep({
                              executionTimeoutMinutes:
                                e.target.value === ""
                                  ? null
                                  : Number(e.target.value),
                            })
                          }
                        />
                        <p className="text-xs leading-5 text-muted-foreground">
                          留空不限制；设置后，超时会停止当前步骤。
                        </p>
                      </div>
                      {agent?.kind === "claude" && (
                        <div className="space-y-2">
                          <Label>Claude Code API</Label>
                          <Choice
                            label="步骤 API"
                            value={selected.providerId || "local"}
                            onChange={(id) =>
                              updateStep({
                                providerId: id === "local" ? null : id,
                              })
                            }
                            options={[
                              { value: "local", label: "本机配置" },
                              ...(snapshot.providers || []).map((p) => ({
                                value: p.id,
                                label: p.name,
                              })),
                            ]}
                          />
                        </div>
                      )}
                    </div>
                  </details>
                </>
              )}
              <details className="space-y-3 border-t pt-3 text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  连接到下一节点
                </summary>
                {definition
                  .edges!.filter((e) => e.source === selected.id)
                  .map((edge) => (
                    <div key={edge.id} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs">
                        {edge.branch
                          ? `${edge.branch === "true" ? "是" : "否"} → `
                          : "→ "}
                        {
                          definition.steps.find((s) => s.id === edge.target)
                            ?.title
                        }
                      </span>
                      <IconButton
                        label={`删除到${definition.steps.find((s) => s.id === edge.target)?.title}的连线`}
                        onClick={() =>
                          update({
                            edges: definition.edges!.filter(
                              (e) => e.id !== edge.id,
                            ),
                          })
                        }
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                  ))}
                {(selected.kind === "condition"
                  ? (["true", "false"] as const)
                  : [undefined]
                ).map((branch) => (
                  <Choice
                    key={branch || "next"}
                    label={
                      branch
                        ? `连接“${branch === "true" ? "是" : "否"}”分支`
                        : "连接下一节点"
                    }
                    value="choose"
                    options={[
                      {
                        value: "choose",
                        label: branch
                          ? `“${branch === "true" ? "是" : "否"}”分支连接到…`
                          : "选择下一节点…",
                      },
                      ...definition.steps
                        .filter(
                          (s) =>
                            s.id !== selected.id &&
                            !definition.edges!.some(
                              (e) =>
                                e.source === selected.id &&
                                e.target === s.id &&
                                e.branch === branch,
                            ),
                        )
                        .map((s) => ({ value: s.id, label: s.title })),
                    ]}
                    onChange={(target) => {
                      if (target === "choose") return;
                      const edges = [
                        ...definition.edges!,
                        {
                          id: crypto.randomUUID(),
                          source: selected.id,
                          target,
                          branch,
                        },
                      ];
                      const message = validateGraph({ ...definition, edges });
                      if (message.includes("循环")) {
                        setError(message);
                        return;
                      }
                      setError("");
                      update({ edges });
                    }}
                  />
                ))}
              </details>
              {selected.kind === "review" && (
                <div className="space-y-2">
                  <Label>检查未通过时</Label>
                  <Choice
                    label="检查失败处理"
                    value={String(selected.maxRepairs)}
                    onChange={(v) => updateStep({ maxRepairs: Number(v) })}
                    options={[
                      { value: "0", label: "暂停，等待处理" },
                      ...(repairSource(definition, selected.id)
                        ? [
                            {
                              value: "1",
                              label: "让上一步 Agent 返工，最多 1 次",
                            },
                            {
                              value: "2",
                              label: "让上一步 Agent 返工，最多 2 次",
                            },
                          ]
                        : []),
                    ]}
                  />
                  <p className="text-xs text-muted-foreground">
                    超过返工次数后暂停；返工沿用上一步的权限和 API。
                  </p>
                </div>
              )}
            </section>
          )}
        </div>
      </fieldset>
      {!desktop && (
        <p className="text-xs text-muted-foreground">
          浏览器中可编辑和保存工作流，生成计划与执行需要桌面版。
        </p>
      )}
    </div>
  );
}
