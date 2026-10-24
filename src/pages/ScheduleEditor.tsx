import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  FolderOpen,
  Save,
  ChevronDown,
  LoaderCircle,
  ArrowUpRight,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Choice, IconButton } from "@/components/workspace/shared";
import { call, desktop, pickDirectory } from "@/lib/api";
import { normalizePermission, permissionOptions } from "@/lib/permissions";
import {
  localTimezone,
  scheduleTime,
  validateSchedule,
  weekdays,
  type Schedule,
  type ScheduleDefinition,
  type ScheduleRule,
  type ScheduleTarget,
} from "@/lib/schedules";
import type { Snapshot, Task } from "@/lib/types";
import type { WorkflowDefinition } from "@/lib/workflows";
import { ScheduleRunStatus } from "./Schedules";
import { openScheduledRun } from "@/lib/scheduleActions";
function localDateInput(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function ScheduleEditorPage({
  definition: def,
  item,
  snapshot,
  workflows,
  onChange,
  onSaved,
  onBack,
  onOpen,
}: {
  definition: ScheduleDefinition;
  item?: Schedule;
  snapshot: Snapshot;
  workflows: WorkflowDefinition[];
  onChange: (definition: ScheduleDefinition) => void;
  onSaved: () => Promise<void>;
  onBack: () => void;
  onOpen: (task: Task) => void;
}) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [next, setNext] = useState<string>();
  const [previewError, setPreviewError] = useState("");
  const [historyCount, setHistoryCount] = useState(10);
  const ruleKey = JSON.stringify(def.rule);
  const agents = snapshot.agents.filter((a) => a.available);
  const target = def.target;
  const targetDrafts = useRef<
    Partial<Record<ScheduleTarget["kind"], ScheduleTarget>>
  >({});
  const agent =
    target.kind === "agent"
      ? snapshot.agents.find((a) => a.id === target.agentId)
      : undefined;
  const rule = def.rule;
  const cadence =
    rule.kind === "weekly" && [...rule.weekdays].sort().join() === "0,1,2,3,4"
      ? "weekdays"
      : rule.kind;
  const timezone = "timezone" in rule ? rule.timezone : localTimezone();
  const sameTiming =
    item &&
    JSON.stringify(item.definition.rule) === ruleKey &&
    item.definition.enabled === def.enabled;
  const preview = sameTiming ? item.nextRunAt : next;
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setNext(undefined);
      setPreviewError("");
      if (!desktop) return;
      void call<string[]>("preview_schedule", { rule: JSON.parse(ruleKey) })
        .then((values) => {
          if (!cancelled) setNext(values[0]);
        })
        .catch((e) => {
          if (!cancelled) setPreviewError(String(e));
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ruleKey]);
  function update(patch: Partial<ScheduleDefinition>) {
    onChange({ ...def, ...patch });
  }
  function setCadence(kind: string) {
    const time = "time" in rule ? rule.time : "09:00";
    const nextRule: ScheduleRule =
      kind === "once"
        ? { kind, at: new Date(Date.now() + 3600000).toISOString() }
        : kind === "interval"
          ? { kind, minutes: 60 }
          : kind === "weekly" || kind === "weekdays"
            ? {
                kind: "weekly",
                time,
                timezone,
                weekdays: kind === "weekdays" ? [0, 1, 2, 3, 4] : [0],
              }
            : { kind: "daily", time, timezone };
    update({ rule: nextRule });
  }
  async function save() {
    if (lock.current) return;
    const invalid = validateSchedule(def);
    if (invalid) {
      setError(invalid);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await call<Schedule>("save_schedule", { definition: def });
      onChange(saved.definition);
      await onSaved();
      toast.success("定时任务已保存");
      onBack();
    } catch (e) {
      setError(String(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      className="mx-auto max-w-5xl p-5 sm:p-8"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="sticky top-0 z-10 mb-6 flex items-center gap-3 bg-background py-2">
        <IconButton
          type="button"
          label="返回定时任务"
          onClick={onBack}
          disabled={busy}
        >
          <ArrowLeft />
        </IconButton>
        <h1 className="flex-1 text-lg font-semibold">
          {def.id ? "编辑定时任务" : "新建定时任务"}
        </h1>
        <Button type="submit" disabled={!desktop || busy}>
          {busy ? <LoaderCircle className="animate-spin" /> : <Save />}保存
        </Button>
      </div>
      {!desktop && (
        <p className="mb-4 text-sm text-muted-foreground">
          定时执行仅在桌面版可用。
        </p>
      )}
      {item && item.definition.revision !== def.revision && (
        <div
          role="status"
          className="mb-4 flex items-center justify-between gap-3 rounded-md bg-muted p-3 text-sm"
        >
          配置已更新
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onChange(structuredClone(item.definition))}
          >
            重新载入
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error}
        </p>
      )}
      <fieldset
        disabled={busy}
        className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]"
      >
        <section aria-label="执行内容" className="min-w-0 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="schedule-name">名称</Label>
            <Input
              id="schedule-name"
              value={def.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="例如：每日代码检查"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="schedule-project">项目目录</Label>
            <div className="flex gap-2">
              <Input
                id="schedule-project"
                value={def.project}
                list="schedule-projects"
                onChange={(e) => update({ project: e.target.value })}
                placeholder="选择或输入项目目录"
              />
              <IconButton
                type="button"
                label="选择定时任务项目"
                onClick={() =>
                  void pickDirectory()
                    .then((project) => {
                      if (project) update({ project });
                    })
                    .catch((e) => toast.error(String(e)))
                }
              >
                <FolderOpen />
              </IconButton>
            </div>
            <datalist id="schedule-projects">
              {snapshot.projects
                .filter(
                  (p) =>
                    !(snapshot.temporaryProjects || []).some(
                      (t) => t.path === p,
                    ),
                )
                .map((p) => (
                  <option key={p} value={p} />
                ))}
            </datalist>
          </div>
          <div className="space-y-2">
            <Label>执行内容</Label>
            <Choice
              label="执行类型"
              className="w-full"
              value={target.kind}
              onChange={(kind) => {
                targetDrafts.current[target.kind] = target;
                const type = kind === "workflow" ? "workflow" : "agent";
                update({
                  target:
                    targetDrafts.current[type] ||
                    (type === "workflow"
                      ? { kind: "workflow", workflowId: workflows[0]?.id || "" }
                      : {
                          kind: "agent",
                          agentId: agents[0]?.id || "",
                          prompt: "",
                          permission: normalizePermission(
                            agents[0]?.kind || "",
                          ),
                          model: "",
                          providerId: null,
                        }),
                });
              }}
              options={[
                { value: "agent", label: "Agent 任务" },
                { value: "workflow", label: "已保存的工作流" },
              ]}
            />
          </div>
          {target.kind === "agent" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Agent</Label>
                  <Choice
                    label="定时任务 Agent"
                    className="w-full"
                    value={target.agentId || "unset"}
                    onChange={(agentId) => {
                      const selected = agents.find((a) => a.id === agentId);
                      if (selected)
                        update({
                          target: {
                            ...target,
                            agentId,
                            permission: normalizePermission(selected.kind),
                            model: "",
                            providerId: null,
                          },
                        });
                    }}
                    options={[
                      { value: "unset", label: "选择 Agent" },
                      ...agents.map((a) => ({ value: a.id, label: a.name })),
                      ...(target.agentId &&
                      !agents.some((a) => a.id === target.agentId)
                        ? [
                            {
                              value: target.agentId,
                              label: `${agent?.name || target.agentId}（不可用）`,
                            },
                          ]
                        : []),
                    ]}
                  />
                </div>
                <div className="space-y-2">
                  <Label>执行权限</Label>
                  <Choice
                    label="定时任务执行权限"
                    className="w-full"
                    value={target.permission}
                    onChange={(permission) =>
                      update({ target: { ...target, permission } })
                    }
                    options={permissionOptions(agent?.kind || "")}
                  />
                </div>
              </div>
              {agent?.kind === "claude" && (
                <div className="space-y-2">
                  <Label>Claude Code API</Label>
                  <Choice
                    label="定时任务 Claude Code API"
                    className="w-full"
                    value={target.providerId || "default"}
                    onChange={(id) =>
                      update({
                        target: {
                          ...target,
                          providerId: id === "default" ? null : id,
                        },
                      })
                    }
                    options={[
                      { value: "default", label: "使用 Agent 当前配置" },
                      ...(snapshot.providers || []).map((p) => ({
                        value: p.id,
                        label: p.name,
                      })),
                      ...(target.providerId &&
                      !(snapshot.providers || []).some(
                        (p) => p.id === target.providerId,
                      )
                        ? [
                            {
                              value: target.providerId,
                              label: "配置已删除，请重新选择",
                            },
                          ]
                        : []),
                    ]}
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="schedule-prompt">任务内容</Label>
                <Textarea
                  id="schedule-prompt"
                  value={target.prompt}
                  onChange={(e) =>
                    update({ target: { ...target, prompt: e.target.value } })
                  }
                  placeholder="描述每次需要执行的任务…"
                  className="min-h-48 resize-y leading-7"
                />
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label>工作流</Label>
              <Choice
                label="定时执行的工作流"
                className="w-full"
                value={target.workflowId || "unset"}
                onChange={(workflowId) =>
                  update({
                    target: {
                      ...target,
                      workflowId: workflowId === "unset" ? "" : workflowId,
                    },
                  })
                }
                options={[
                  { value: "unset", label: "选择工作流" },
                  ...workflows.map((w) => ({ value: w.id, label: w.name })),
                  ...(target.workflowId &&
                  !workflows.some((w) => w.id === target.workflowId)
                    ? [
                        {
                          value: target.workflowId,
                          label: "工作流已删除或归档",
                        },
                      ]
                    : []),
                ]}
              />
              <p className="text-xs text-muted-foreground">
                每次执行已保存的最新配置。
              </p>
            </div>
          )}
        </section>
        <section
          aria-label="执行时间"
          className="min-w-0 space-y-5 border-t pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">执行时间</h2>
            <Switch
              aria-label="启用定时执行"
              checked={def.enabled}
              onCheckedChange={(enabled) => update({ enabled })}
            />
          </div>
          <Choice
            label="执行频率"
            className="w-full"
            value={cadence}
            onChange={setCadence}
            options={[
              { value: "once", label: "仅一次" },
              { value: "daily", label: "每天" },
              { value: "weekdays", label: "工作日" },
              { value: "weekly", label: "每周" },
              { value: "interval", label: "固定间隔" },
            ]}
          />
          {rule.kind === "once" ? (
            <div className="space-y-2">
              <Label htmlFor="schedule-once">日期与时间</Label>
              <Input
                id="schedule-once"
                type="datetime-local"
                value={localDateInput(rule.at)}
                onChange={(e) =>
                  update({
                    rule: {
                      kind: "once",
                      at:
                        e.target.value &&
                        !Number.isNaN(new Date(e.target.value).getTime())
                          ? new Date(e.target.value).toISOString()
                          : "",
                    },
                  })
                }
              />
            </div>
          ) : rule.kind === "interval" ? (
            <div className="space-y-2">
              <Label htmlFor="schedule-interval">间隔（分钟）</Label>
              <Input
                id="schedule-interval"
                type="number"
                min={1}
                max={43200}
                step={1}
                value={rule.minutes || ""}
                onChange={(e) =>
                  update({ rule: { ...rule, minutes: Number(e.target.value) } })
                }
              />
            </div>
          ) : (
            <>
              {rule.kind === "weekly" && (
                <div
                  className="flex flex-wrap gap-1"
                  role="group"
                  aria-label="每周执行日期"
                >
                  {weekdays.map((day, i) => (
                    <Button
                      key={day}
                      type="button"
                      size="sm"
                      variant={
                        rule.weekdays.includes(i) ? "secondary" : "ghost"
                      }
                      aria-pressed={rule.weekdays.includes(i)}
                      onClick={() =>
                        update({
                          rule: {
                            ...rule,
                            weekdays: rule.weekdays.includes(i)
                              ? rule.weekdays.filter((d) => d !== i)
                              : [...rule.weekdays, i].sort(),
                          },
                        })
                      }
                    >
                      {day}
                    </Button>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="schedule-time">时间</Label>
                <Input
                  id="schedule-time"
                  type="time"
                  value={rule.time}
                  onChange={(e) =>
                    update({ rule: { ...rule, time: e.target.value } })
                  }
                />
              </div>
            </>
          )}
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>{rule.kind === "interval" ? "从启用时间起计算" : timezone}</p>
            {def.enabled && preview && (
              <p>下次：{scheduleTime(preview, timezone)}</p>
            )}
            {!def.enabled && <p>定时执行已暂停</p>}
            {previewError && (
              <p role="alert" className="text-destructive">
                {previewError}
              </p>
            )}
          </div>
          <details className="group border-t pt-4">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
              高级设置
            </summary>
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label>错过执行</Label>
                <Choice
                  label="错过执行时"
                  className="w-full"
                  value={def.catchUp ? "latest" : "skip"}
                  onChange={(value) => update({ catchUp: value === "latest" })}
                  options={[
                    { value: "skip", label: "跳过" },
                    { value: "latest", label: "恢复后补跑一次" },
                  ]}
                />
              </div>
              {"timezone" in rule && (
                <div className="space-y-2">
                  <Label htmlFor="schedule-timezone">时区</Label>
                  <Input
                    id="schedule-timezone"
                    value={rule.timezone}
                    onChange={(e) =>
                      update({ rule: { ...rule, timezone: e.target.value } })
                    }
                    placeholder="Asia/Shanghai"
                  />
                </div>
              )}
              {target.kind === "agent" && (
                <div className="space-y-2">
                  <Label htmlFor="schedule-model">模型</Label>
                  <Input
                    id="schedule-model"
                    value={target.model}
                    onChange={(e) =>
                      update({ target: { ...target, model: e.target.value } })
                    }
                    placeholder="使用 Agent 默认模型"
                  />
                </div>
              )}
            </div>
          </details>
          <p className="text-xs leading-5 text-muted-foreground">
            上一轮未结束时跳过本轮。需要审批时，在任务中处理。
          </p>
        </section>
      </fieldset>
      {!!item?.runs.length && (
        <section
          aria-label="定时任务运行记录"
          className="mt-8 space-y-3 border-t pt-6"
        >
          <h2 className="text-sm font-medium">运行记录</h2>
          <div className="divide-y divide-border/60">
            {item.runs.slice(0, historyCount).map((run) => (
              <div key={run.id} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <time
                      title={`计划：${scheduleTime(run.scheduledAt, timezone)}`}
                    >
                      {scheduleTime(run.startedAt, timezone)}
                    </time>
                    <ScheduleRunStatus run={run} />
                    <span className="text-xs text-muted-foreground">
                      {run.trigger === "manual" ? "手动" : "定时"}
                    </span>
                  </div>
                  {run.message && (
                    <p className="break-words text-xs text-muted-foreground">
                      {run.message}
                    </p>
                  )}
                </div>
                {run.taskId && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={run.status === "starting"}
                    onClick={() => void openScheduledRun(run, onOpen)}
                  >
                    查看任务
                    <ArrowUpRight />
                  </Button>
                )}
              </div>
            ))}
          </div>
          {item.runs.length > historyCount && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setHistoryCount((n) => n + 10)}
            >
              更多记录
            </Button>
          )}
        </section>
      )}
    </form>
  );
}
