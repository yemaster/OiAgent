import { useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
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
import {
  Choice,
  IconButton,
  PageHeading,
  AgentIcon,
} from "@/components/workspace/shared";
import { call, desktop, pickDirectory } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  newStep,
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
  const definition = editor.definition;
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
  const agent = agents.find((a) => a.id === selected?.agentId);
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
    const step = newStep(agents[0]?.id, kind);
    update({ steps: [...definition.steps, step] });
    setSelectedId(step.id);
  }
  function move(offset: number) {
    const steps = [...definition.steps];
    if (index + offset < 0 || index + offset >= steps.length) return;
    [steps[index], steps[index + offset]] = [
      steps[index + offset],
      steps[index],
    ];
    update({ steps });
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
        });
        // Write back to this editor session even if the user navigated to another page.
        onChange(editor.sessionId, {
          definition: {
            ...generated,
            id: definition.id,
            revision: definition.revision,
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
    <div className="mx-auto max-w-6xl space-y-5 p-5 sm:p-8">
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
        <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">执行步骤</h2>
              <span className="text-xs text-muted-foreground">
                {definition.steps.length} / 24
              </span>
            </div>
            <ol className="space-y-1" aria-label="工作流步骤">
              {definition.steps.map((step, i) => (
                <li key={step.id}>
                  <button
                    type="button"
                    aria-current={step.id === selected?.id ? "step" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md border border-transparent px-3 py-3 text-left text-sm transition-colors",
                      step.id === selected?.id
                        ? "border-border bg-accent text-accent-foreground"
                        : "hover:bg-accent/50",
                    )}
                    onClick={() => setSelectedId(step.id)}
                  >
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {step.title || "未命名步骤"}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {stepNames[step.kind]}
                      </div>
                    </div>
                    {step.kind === "agent" && (
                      <AgentIcon
                        kind={
                          snapshot.agents.find((a) => a.id === step.agentId)
                            ?.kind || "custom"
                        }
                      />
                    )}
                  </button>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-1">
              {(["agent", "approval", "review"] as const).map((kind) => (
                <Button
                  key={kind}
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={definition.steps.length >= 24}
                  onClick={() => add(kind)}
                >
                  <Plus />
                  {stepNames[kind]}
                </Button>
              ))}
            </div>
          </section>
          {selected && (
            <section
              className="min-w-0 space-y-4 rounded-lg border bg-card p-4 sm:p-5"
              aria-label="步骤设置"
            >
              <div className="flex items-center gap-2">
                <h2 className="flex-1 text-sm font-medium">
                  第 {index + 1} 步
                </h2>
                <IconButton
                  label="上移步骤"
                  disabled={index === 0}
                  onClick={() => move(-1)}
                >
                  <ArrowUp />
                </IconButton>
                <IconButton
                  label="下移步骤"
                  disabled={index === definition.steps.length - 1}
                  onClick={() => move(1)}
                >
                  <ArrowDown />
                </IconButton>
                <IconButton
                  label="删除步骤"
                  disabled={definition.steps.length <= 1}
                  onClick={() => {
                    const steps = definition.steps.filter(
                      (s) => s.id !== selected.id,
                    );
                    update({ steps });
                    setSelectedId(steps[Math.min(index, steps.length - 1)]?.id);
                  }}
                >
                  <Trash2 />
                </IconButton>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
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
                      updateStep({
                        kind: kind as WorkflowStep["kind"],
                        maxRepairs: 0,
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
                      ? "运行到此处会暂停，确认后将补充说明传给后续步骤。"
                      : "LLM 对照前序步骤的输出检查结果；不会自行读取文件或执行测试。"}
                </p>
              </div>
              {selected.kind === "agent" && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Agent 程序</Label>
                      <Choice
                        label="步骤 Agent"
                        value={selected.agentId}
                        onChange={(agentId) =>
                          updateStep({ agentId, model: "", providerId: null })
                        }
                        options={[
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
                    <div className="grid gap-4 sm:grid-cols-2">
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
              {selected.kind === "review" && (
                <div className="space-y-2">
                  <Label>检查未通过时</Label>
                  <Choice
                    label="检查失败处理"
                    value={String(selected.maxRepairs)}
                    onChange={(v) => updateStep({ maxRepairs: Number(v) })}
                    options={[
                      { value: "0", label: "暂停，等待处理" },
                      ...(index > 0 &&
                      definition.steps[index - 1].kind === "agent"
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
