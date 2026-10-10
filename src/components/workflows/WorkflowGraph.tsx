import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  useUpdateNodeInternals,
  type Node,
  type NodeProps,
  type NodePositionChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  GitBranch,
  Hand,
  LayoutGrid,
  ShieldCheck,
  Terminal,
  Unlink,
} from "lucide-react";
import "@xyflow/react/dist/style.css";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { WorkflowStatus } from "./WorkflowStatus";
import { workflowNodeSurface } from "@/lib/workflow-status";
import { workflowEdgeStatus } from "@/lib/workflow-status";
import { AgentIcon } from "@/components/workspace/shared";
import {
  asGraph,
  layoutGraph,
  stepNames,
  stepStatuses,
  type WorkflowDefinition,
  type WorkflowRun,
  type WorkflowStep,
} from "@/lib/workflows";
import type { Agent } from "@/lib/types";
import { cn } from "@/lib/utils";

type StepNode = Node<
  {
    step: WorkflowStep;
    agent?: Agent;
    agentLabel: string;
    state?: WorkflowRun["steps"][number];
    inherited: boolean;
    root: boolean;
  },
  "step"
>;
const icons = {
  agent: Terminal,
  approval: Hand,
  review: ShieldCheck,
  condition: GitBranch,
};
const StepCard = memo(function StepCard({
  data,
  selected,
  isConnectable,
}: NodeProps<StepNode>) {
  const { step, agent, state } = data;
  const Icon = icons[step.kind];
  const updateInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateInternals(step.id);
  }, [step.id, step.kind, updateInternals]);
  return (
    <div
      className={cn(
        "w-52 rounded-lg border bg-card text-card-foreground shadow-xs transition-[border-color,box-shadow] motion-reduce:transition-none",
        selected ? "border-primary ring-2 ring-primary/20" : "border-border",
        (state?.status === "pending" || state?.status === "skipped") &&
          "border-dashed",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
        className="size-2.5! border-background! bg-muted-foreground!"
      />
      <div
        className={cn(
          "space-y-2 rounded-t-lg px-3 py-3 transition-colors motion-reduce:transition-none",
          state && workflowNodeSurface[state.status],
        )}
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {agent && step.kind === "agent" ? (
            <AgentIcon kind={agent.kind} className="size-4" />
          ) : (
            <Icon className="size-4" />
          )}
          <span className="truncate">
            {step.kind === "agent"
              ? agent?.name || data.agentLabel || "选择 Agent"
              : stepNames[step.kind]}
          </span>
          {data.root && <span className="ml-auto text-[10px]">起点</span>}
        </div>
        <p className="truncate text-sm font-medium">
          {step.title || "未命名节点"}
        </p>
        <div className="flex min-h-5 items-center justify-between gap-1 text-[11px] text-muted-foreground">
          {state ? (
            <WorkflowStatus status={state.status} className="text-[11px]" />
          ) : (
            <span>
              {step.kind === "agent"
                ? `${data.inherited ? "默认 Agent · " : ""}${step.permission === "workspace-write" ? "修改项目" : "只读"}`
                : step.kind === "condition"
                  ? "LLM 判断条件"
                  : "等待前置节点完成"}
            </span>
          )}
        </div>
      </div>
      {step.kind === "condition" ? (
        <div className="border-t py-1 text-right text-[11px] text-muted-foreground">
          {(["true", "false"] as const).map((branch) => (
            <div key={branch} className="relative py-1 pr-3">
              {branch === "true" ? "是" : "否"}
              <Handle
                type="source"
                id={branch}
                position={Position.Right}
                isConnectable={isConnectable}
                className={cn(
                  "size-2.5!",
                  branch === "true" ? "bg-primary!" : "bg-muted-foreground!",
                )}
              />
            </div>
          ))}
        </div>
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          isConnectable={isConnectable}
          className="size-2.5! border-background! bg-muted-foreground!"
        />
      )}
    </div>
  );
});
const noAgents: Agent[] = [];
const nodeTypes = { step: StepCard };
export function WorkflowGraph({
  definition: original,
  agents = noAgents,
  selectedId,
  states,
  onSelect,
  onChange,
  disabled = false,
  className,
}: {
  definition: WorkflowDefinition;
  agents?: Agent[];
  selectedId?: string;
  states?: WorkflowRun["steps"];
  onSelect: (id: string) => void;
  onChange?: (definition: WorkflowDefinition) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { resolvedTheme } = useTheme();
  const [dragPositions, setDragPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const definition = useMemo(() => asGraph(original), [original]);
  const layout = useMemo(
    () =>
      definition.steps.every((s) => s.position)
        ? definition
        : layoutGraph(definition),
    [definition],
  );
  const [selectedEdge, setSelectedEdge] = useState<string>();
  const flow = useRef<ReactFlowInstance<StepNode>>(null);
  const editable = !!onChange && !disabled;
  const nodes: StepNode[] = useMemo(
    () =>
      definition.steps.map((step, i) => ({
        id: step.id,
        type: "step",
        position:
          dragPositions[step.id] ?? step.position ?? layout.steps[i].position!,
        selected: selectedId === step.id,
        ariaLabel: `${step.title}，${states?.[i] ? stepStatuses[states[i].status] : stepNames[step.kind]}`,
        data: {
          step,
          agentLabel: step.agentId || definition.defaultAgentId || "",
          agent: agents.find(
            (a) => a.id === (step.agentId || definition.defaultAgentId),
          ),
          inherited: !step.agentId,
          state: states?.[i],
          root: !definition.edges?.some((e) => e.target === step.id),
        },
      })),
    [definition, layout, dragPositions, selectedId, states, agents],
  );
  const edges = useMemo(() => {
    const byId = new Map(
      definition.steps.map((step, i) => [step.id, states?.[i]]),
    );
    const colors = {
      idle: "var(--muted-foreground)",
      pending: "var(--muted-foreground)",
      running: "var(--workflow-running)",
      completed: "var(--workflow-completed)",
      approval: "var(--workflow-approval)",
      failed: "var(--destructive)",
      cancelled: "var(--muted-foreground)",
      skipped: "var(--muted-foreground)",
    };
    return definition.edges!.map((edge) => {
      const status = workflowEdgeStatus(
        edge,
        byId.get(edge.source),
        byId.get(edge.target),
      );
      const selected = selectedEdge === edge.id;
      const muted =
        status === "pending" || status === "skipped" || status === "cancelled";
      const color = colors[status];
      return {
        ...edge,
        sourceHandle: edge.branch,
        selected,
        type: "smoothstep",
        animated: status === "running",
        ariaLabel: `${definition.steps.find((s) => s.id === edge.source)?.title} → ${definition.steps.find((s) => s.id === edge.target)?.title}${edge.branch ? `，${edge.branch === "true" ? "是" : "否"}` : ""}，${status === "idle" ? "连接" : stepStatuses[status]}`,
        label:
          edge.branch === "true"
            ? "是"
            : edge.branch === "false"
              ? "否"
              : undefined,
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: {
          stroke: color,
          strokeWidth: selected ? 3 : muted || status === "idle" ? 1.5 : 2,
          strokeDasharray:
            status === "skipped"
              ? "3 5"
              : status === "pending" || status === "cancelled"
                ? "5 5"
                : undefined,
          opacity: status === "skipped" ? 0.35 : muted ? 0.5 : 1,
        },
        labelStyle: { fill: "var(--foreground)", fontSize: 11 },
        labelBgStyle: { fill: "var(--card)" },
      };
    });
  }, [definition, states, selectedEdge]);

  return (
    <div
      className={cn(
        "workflow-graph h-[480px] min-w-0 overflow-hidden rounded-lg border bg-background text-foreground",
        className,
      )}
      aria-label="工作流画布"
    >
      <ReactFlow<StepNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.25}
        maxZoom={1.5}
        colorMode={resolvedTheme === "dark" ? "dark" : "light"}
        style={
          {
            background: "var(--background)",
            "--xy-controls-button-color-hover": "var(--foreground)",
            "--xy-attribution-background-color": "var(--muted)",
            "--xy-controls-button-background-color": "var(--card)",
            "--xy-controls-button-color": "var(--foreground)",
            "--xy-controls-button-background-color-hover": "var(--accent)",
            "--xy-controls-button-border-color": "var(--border)",
          } as React.CSSProperties
        }
        onInit={(instance) => {
          flow.current = instance;
        }}
        nodesDraggable={editable}
        nodesConnectable={editable}
        edgesReconnectable={false}
        deleteKeyCode={null}
        onNodeClick={(_, node) => {
          setSelectedEdge(undefined);
          onSelect(node.id);
        }}
        onEdgeClick={(_, edge) => setSelectedEdge(edge.id)}
        onPaneClick={() => setSelectedEdge(undefined)}
        onNodesChange={(changes) => {
          if (!editable) return;
          const positions = changes.filter(
            (c): c is NodePositionChange =>
              c.type === "position" && !!c.position,
          );
          if (!positions.length) return;
          if (positions.some((c) => c.dragging)) {
            // Keep pointer-frequency updates inside the canvas; commit the draft on drop.
            setDragPositions((old) => ({
              ...old,
              ...Object.fromEntries(positions.map((c) => [c.id, c.position!])),
            }));
            return;
          }
          onChange!({
            ...definition,
            steps: definition.steps.map((step) => {
              const position =
                positions.find((c) => c.id === step.id)?.position ??
                dragPositions[step.id];
              return position ? { ...step, position } : step;
            }),
          });
          setDragPositions({});
        }}
        onConnect={(connection) => {
          if (
            !editable ||
            !connection.source ||
            !connection.target ||
            connection.source === connection.target
          )
            return;
          const branch =
            connection.sourceHandle === "true" ||
            connection.sourceHandle === "false"
              ? connection.sourceHandle
              : undefined;
          if (
            definition.edges!.some(
              (e) =>
                e.source === connection.source &&
                e.target === connection.target &&
                e.branch === branch,
            )
          )
            return;
          // Reject cycles while allowing a condition to be wired one outlet at a time.
          const descendants = new Set([connection.target]);
          for (let i = 0; i < definition.steps.length; i++)
            for (const e of definition.edges!)
              if (descendants.has(e.source)) descendants.add(e.target);
          if (descendants.has(connection.source)) {
            toast.error("不能连接回前置节点，请使用检查节点的返工设置");
            return;
          }
          onChange!({
            ...definition,
            edges: [
              ...definition.edges!,
              {
                id: crypto.randomUUID(),
                source: connection.source,
                target: connection.target,
                branch,
              },
            ],
          });
        }}
      >
        <Background color="var(--border)" gap={20} />
        <Controls showInteractive={false} />
        {states && (
          <Panel
            position="top-left"
            className="pointer-events-none! flex flex-wrap gap-1 rounded-md border bg-card/95 p-1.5"
            aria-label="节点状态图例"
          >
            {(
              [
                "pending",
                "running",
                "completed",
                "approval",
                "failed",
                "skipped",
                "cancelled",
              ] as const
            )
              .filter((status) =>
                states.some((state) => state.status === status),
              )
              .map((status) => (
                <WorkflowStatus
                  key={status}
                  status={status}
                  className="text-[10px]"
                />
              ))}
          </Panel>
        )}
        {editable && (
          <Panel position="top-right" className="flex gap-1">
            {selectedEdge && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  onChange!({
                    ...definition,
                    edges: definition.edges!.filter(
                      (e) => e.id !== selectedEdge,
                    ),
                  });
                  setSelectedEdge(undefined);
                }}
              >
                <Unlink />
                删除连线
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                onChange!(layoutGraph(definition));
                requestAnimationFrame(
                  () =>
                    void flow.current?.fitView({
                      duration: window.matchMedia(
                        "(prefers-reduced-motion: reduce)",
                      ).matches
                        ? 0
                        : 200,
                      padding: 0.15,
                    }),
                );
              }}
            >
              <LayoutGrid />
              整理布局
            </Button>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
