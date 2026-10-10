import { Trash2 } from "lucide-react";
import { Choice, IconButton } from "@/components/workspace/shared";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  repairSource,
  stepNames,
  validateGraph,
  type WorkflowDefinition,
  type WorkflowStep,
} from "@/lib/workflows";
import type { Agent, ProviderProfile } from "@/lib/types";
export function WorkflowNodeSettings({
  definition,
  selected,
  agents,
  profiles,
  disabled,
  section,
  onSectionChange,
  onChange: update,
  onSelect: setSelectedId,
  onError: setError,
}: {
  definition: WorkflowDefinition;
  selected: WorkflowStep;
  agents: Agent[];
  profiles: ProviderProfile[];
  disabled: boolean;
  section: string;
  onSectionChange: (section: string) => void;
  onChange: (patch: Partial<WorkflowDefinition>) => void;
  onSelect: (id: string) => void;
  onError: (message: string) => void;
}) {
  const index = definition.steps.findIndex((s) => s.id === selected.id);
  const agent = agents.find(
    (a) => a.id === (selected.agentId || definition.defaultAgentId),
  );
  function updateStep(patch: Partial<WorkflowStep>) {
    update({
      steps: definition.steps.map((s) =>
        s.id === selected.id ? { ...s, ...patch } : s,
      ),
    });
  }
  return (
    <fieldset
      disabled={disabled}
      className="flex min-h-0 min-w-0 flex-1 flex-col disabled:opacity-70"
      aria-label="步骤设置"
    >
      <div className="shrink-0 px-4 pt-4">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <Choice
              className="w-full min-w-0"
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
                  (e) => e.source !== selected.id && e.target !== selected.id,
                ),
              });
              setSelectedId(steps[Math.min(index, steps.length - 1)]?.id);
            }}
          >
            <Trash2 />
          </IconButton>
        </div>
      </div>
      <Tabs
        value={section}
        onValueChange={onSectionChange}
        className="min-h-0 flex-1 gap-0"
      >
        <TabsList variant="line" className="mx-4 my-2 shrink-0">
          <TabsTrigger value="content">内容</TabsTrigger>
          {(selected.kind === "agent" || selected.kind === "review") && (
            <TabsTrigger value="execution">执行</TabsTrigger>
          )}
          <TabsTrigger value="connections">连接</TabsTrigger>
        </TabsList>
        <TabsContent
          value="content"
          className="min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4"
        >
          <div className="grid gap-4">
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
                className="w-full min-w-0"
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
                        (selected.kind !== "condition" && kind !== "condition"),
                    ),
                  })
                }
                options={Object.entries(stepNames).map(([value, label]) => ({
                  value,
                  label,
                }))}
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
              className="h-48 min-h-32 max-h-80 resize-y field-sizing-fixed"
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
        </TabsContent>
        <TabsContent
          value="execution"
          className="min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4"
        >
          {selected.kind === "agent" && (
            <>
              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label>Agent 程序</Label>
                  <Choice
                    className="w-full min-w-0"
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
                    className="w-full min-w-0"
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
              <div className="space-y-4 border-t pt-4 text-sm">
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="workflow-step-model">模型（可选）</Label>
                    <Input
                      id="workflow-step-model"
                      value={selected.model}
                      onChange={(e) => updateStep({ model: e.target.value })}
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
                        className="w-full min-w-0"
                        label="步骤 API"
                        value={selected.providerId || "local"}
                        onChange={(id) =>
                          updateStep({
                            providerId: id === "local" ? null : id,
                          })
                        }
                        options={[
                          { value: "local", label: "本机配置" },
                          ...profiles.map((p) => ({
                            value: p.id,
                            label: p.name,
                          })),
                        ]}
                      />
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
          {selected.kind === "review" && (
            <div className="space-y-2">
              <Label>检查未通过时</Label>
              <Choice
                className="w-full min-w-0"
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
        </TabsContent>
        <TabsContent
          value="connections"
          className="min-h-0 overflow-y-auto overscroll-contain p-4"
        >
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">连接到下一节点</p>
            {definition
              .edges!.filter((e) => e.source === selected.id)
              .map((edge) => (
                <div key={edge.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {edge.branch
                      ? `${edge.branch === "true" ? "是" : "否"} → `
                      : "→ "}
                    {definition.steps.find((s) => s.id === edge.target)?.title}
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
                className="w-full min-w-0"
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
          </div>
        </TabsContent>
      </Tabs>
    </fieldset>
  );
}
