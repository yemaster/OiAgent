import { ContextActions } from "./ContextActions";
import { copyText } from "@/lib/clipboard";
import { EditFileCard } from "./EditFileCard";
import { editedFiles, type OpenProjectFile } from "@/lib/editFiles";
import { parseCommands } from "@/lib/commands";
import { useId, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Circle,
  Copy,
  FilePenLine,
  FileText,
  Globe,
  ListChecks,
  LoaderCircle,
  Search,
  Terminal,
  TriangleAlert,
  Workflow,
  Wrench,
} from "lucide-react";
import { AgentIcon, StatusBadge } from "./shared";
import { agentNames, compact, isActive, type Task } from "@/lib/types";
import {
  decode,
  describeTool,
  exitCode,
  fieldName,
  plain,
  record,
  type TranscriptItem,
} from "@/lib/transcript";
import { cn } from "@/lib/utils";
const icons = {
  command: Terminal,
  read: FileText,
  edit: FilePenLine,
  search: Search,
  web: Globe,
  agent: Workflow,
  plan: ListChecks,
  tool: Wrench,
};
function Code({
  children,
  diff = false,
}: {
  children: string;
  diff?: boolean;
}) {
  return (
    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/70 p-3 font-mono text-xs leading-5">
      {diff
        ? children.split("\n").map((line, i) => (
            <span
              key={i}
              className={cn(
                "block",
                line.startsWith("+") &&
                  "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
                line.startsWith("-") &&
                  "bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300",
              )}
            >
              {line || " "}
            </span>
          ))
        : children}
    </pre>
  );
}
const hiddenFields = new Set([
  "chunk_id",
  "session_id",
  "original_token_count",
  "signature",
  "encrypted_content",
  "data",
  "type",
  "wall_time_seconds",
  "exit_code",
  "exitCode",
]);
/** Render content blocks and tool envelopes instead of stringifying provider JSON. */
export function ToolValue({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}) {
  const v = decode(value);
  if (v == null) return null;
  if (typeof v !== "object")
    return (
      <Code diff={typeof v === "string" && v.includes("*** Begin Patch")}>
        {typeof v === "string" &&
        /^(?:Chunk ID:|Wall time:|Process exited with code)/.test(v) &&
        v.includes("Final output:")
          ? v
              .slice(v.indexOf("Final output:") + "Final output:".length)
              .trimStart()
          : String(v)}
      </Code>
    );
  if (depth > 6) return <Code>{plain(v)}</Code>;
  if (Array.isArray(v))
    return (
      <div className="space-y-2">
        {v.map((item, i) => (
          <ToolValue key={i} value={item} depth={depth + 1} />
        ))}
      </div>
    );
  const o = record(v);
  if (["image", "input_image", "image_url"].includes(String(o.type)))
    return (
      <p className="text-xs text-muted-foreground">
        图片附件（原始数据已保留）
      </p>
    );
  if (o.text != null) return <ToolValue value={o.text} depth={depth + 1} />;
  const keys = Object.keys(o).filter(
    (k) => !hiddenFields.has(k) && o[k] != null && o[k] !== "",
  );
  if (!keys.length)
    return <p className="text-xs text-muted-foreground">无文本输出</p>;
  if (
    keys.length === 1 &&
    ["output", "content", "result", "response", "stdout"].includes(keys[0])
  )
    return <ToolValue value={o[keys[0]]} depth={depth + 1} />;
  return (
    <dl className="space-y-3">
      {keys.map((k) => (
        <div key={k}>
          <dt className="mb-1.5 text-xs font-medium text-muted-foreground">
            {fieldName(k)}
          </dt>
          <dd>
            <ToolValue value={o[k]} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function SubagentCard({
  task,
  onOpen,
}: {
  task: Task;
  onOpen: (task: Task) => void;
}) {
  return (
    <button
      onClick={() => onOpen(task)}
      className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-ring"
    >
      <div className="flex items-center gap-2">
        <AgentIcon kind={task.agentKind} className="size-4" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {task.subagentName || task.title}
        </span>
        <StatusBadge status={task.status} />
        <ArrowUpRight className="size-3.5 text-muted-foreground" />
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
        {task.preview || task.prompt || "暂无消息"}
      </p>
      <div className="mt-2 flex gap-3 text-[11px] text-muted-foreground">
        <span>{agentNames[task.agentKind] || task.agentKind}</span>
        {task.model && <span className="truncate">{task.model}</span>}
        <span className="ml-auto shrink-0 tabular-nums">
          {task.usage.known
            ? `${compact(task.usage.input + task.usage.output)} tokens`
            : "用量未上报"}
        </span>
      </div>
    </button>
  );
}
function ToolStep({
  item,
  task,
  childTasks,
  onOpen,
  onOpenFile,
  depth,
}: {
  item: Extract<TranscriptItem, { kind: "tool" }>;
  task: Task;
  childTasks: Task[];
  onOpen: (task: Task) => void;
  onOpenFile?: OpenProjectFile;
  depth: number;
}) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const { tool } = item;
  const info = describeTool(tool);
  const Icon = icons[info.kind];
  const code = exitCode(tool.output);
  const failed = tool.state === "failed" || (code !== undefined && code !== 0);
  const running =
    !failed &&
    (tool.state === "running" || tool.state === "called") &&
    isActive(task);
  const done = tool.state === "completed" && !failed;
  // Only actual execution containers expand automatically; leaf calls stay compact.
  const expanded = manualOpen ?? (item.nested.length > 0 && depth < 4);
  const status = failed
    ? "执行失败"
    : running
      ? "等待结果"
      : done
        ? info.kind === "agent" && info.title === "派发子 Agent"
          ? "已派发"
          : "已完成"
        : "未记录结果";
  const linked = childTasks.filter(
    (t) =>
      (tool.childIds || []).some(
        (id) => id === t.subagentId || id === t.sessionId || id === t.id,
      ) ||
      (!!tool.callId && !!t.subagentId?.endsWith(tool.callId)),
  );
  const args = record(tool.input);
  const plan = args.plan || args.todos || args.items;
  const command = info.kind === "command";
  const parsedCommands = useMemo(
    () => (command ? parseCommands(tool.name, tool.input) : null),
    [command, tool.name, tool.input],
  );
  const commandPreview = (info.detail || info.code || info.title)
    .split("\n")[0]
    .slice(0, 160);
  const cwd = info.cwd || plain(args.workdir || args.cwd);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已复制");
    } catch {
      toast.error("复制失败，请手动选择文本复制");
    }
  }
  const files = info.kind === "edit" ? editedFiles(tool, task.project) : [];
  const disclosure = (
    <details
      className="group/step my-1"
      data-tool-id={tool.callId || undefined}
      open={expanded}
    >
      <summary
        onClick={(e) => {
          e.preventDefault();
          setManualOpen(!expanded);
        }}
        className="flex cursor-pointer list-none items-center gap-2 rounded-md px-1 py-2 text-xs transition-colors hover:bg-muted/60 [&::-webkit-details-marker]:hidden"
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        {command ? (
          <span className="min-w-0 flex-1">
            <code className="block truncate text-xs" title={commandPreview}>
              {commandPreview}
            </code>
            <span className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
              <span className="shrink-0">{info.title}</span>
              {cwd && (
                <span className="truncate" title={cwd}>
                  {cwd}
                </span>
              )}
            </span>
          </span>
        ) : (
          <>
            <span className="shrink-0 font-medium">{info.title}</span>
            <span
              className="min-w-0 flex-1 truncate text-muted-foreground"
              title={info.detail}
            >
              {info.detail}
            </span>
          </>
        )}
        <span
          className={cn(
            "ml-2 flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground",
            failed && "text-destructive",
          )}
        >
          {failed ? (
            <TriangleAlert className="size-3" />
          ) : running ? (
            <LoaderCircle className="size-3 animate-spin" />
          ) : done ? (
            <Check className="size-3" />
          ) : (
            <Circle className="size-2.5" />
          )}
          {status}
        </span>
        <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform group-open/step:rotate-90" />
      </summary>
      <div className="mb-4 ml-2.5 space-y-4 border-l pl-4 pt-2">
        {tool.input != null && (
          <section aria-label="执行内容">
            {info.kind === "plan" && Array.isArray(plan) ? (
              <ul className="space-y-2">
                {plan.map((p, i) => {
                  const row = record(p);
                  return (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      {row.status === "completed" || row.completed === true ? (
                        <Check className="size-3.5 text-emerald-600" />
                      ) : (
                        <Circle className="size-3.5 text-muted-foreground" />
                      )}
                      <span>
                        {plain(row.step || row.content || row.text || p)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : command ? (
              <div className="space-y-4">
                {parsedCommands?.calls.map((call, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {call.command
                          ? `命令${parsedCommands.calls.length > 1 ? ` ${i + 1}` : ""}`
                          : call.name}
                      </span>
                      {call.cwd && (
                        <span
                          className="min-w-0 flex-1 truncate"
                          title={call.cwd}
                        >
                          {call.cwd}
                        </span>
                      )}
                      {call.dynamic && <span>条件调用</span>}
                      {call.command && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="ml-auto"
                          aria-label={`复制命令${i ? ` ${i + 1}` : ""}`}
                          onClick={() => void copy(call.command!)}
                        >
                          <Copy className="size-3" />
                        </Button>
                      )}
                    </div>
                    {call.command ? (
                      <Code>{call.command}</Code>
                    ) : call.input && Object.keys(record(call.input)).length ? (
                      <ToolValue value={call.input} />
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        参数在运行时生成，请查看原始调用。
                      </p>
                    )}
                  </div>
                ))}
                {(!parsedCommands?.calls.length ||
                  parsedCommands.unresolved) && (
                  <p className="text-xs leading-5 text-muted-foreground">
                    {parsedCommands?.calls.length
                      ? "部分参数或执行分支在运行时确定，以上为可解析的调用。"
                      : "此脚本无法静态还原为命令，可展开原始调用查看。"}
                  </p>
                )}
                {(parsedCommands?.wrapped || !parsedCommands?.calls.length) && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">原始调用</summary>
                    <div className="mt-2">
                      <Code>
                        {typeof tool.input === "string"
                          ? tool.input
                          : plain(args.code || args.script) ||
                            JSON.stringify(tool.input, null, 2)}
                      </Code>
                    </div>
                  </details>
                )}
              </div>
            ) : info.kind === "edit" &&
              (args.old_string != null || args.new_string != null) ? (
              <>
                <p className="mb-2 break-all text-xs text-muted-foreground">
                  {info.detail}
                </p>
                <Code diff>{`${plain(args.old_string)
                  .split("\n")
                  .map((l) => `- ${l}`)
                  .join("\n")}\n${plain(args.new_string)
                  .split("\n")
                  .map((l) => `+ ${l}`)
                  .join("\n")}`}</Code>
              </>
            ) : (
              <ToolValue value={tool.input} />
            )}
          </section>
        )}
        {tool.output != null && (
          <section aria-label="执行输出">
            <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              <span>执行结果</span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="复制执行结果"
                onClick={() => void copy(plain(tool.output))}
              >
                <Copy className="size-3" />
              </Button>
              {code !== undefined && (
                <span
                  className={cn("ml-auto", code !== 0 && "text-destructive")}
                >
                  退出码 {code}
                </span>
              )}
            </div>
            <ToolValue value={tool.output} />
          </section>
        )}
        {linked.length > 0 && (
          <div className="space-y-2">
            {linked.map((t) => (
              <SubagentCard key={t.id} task={t} onOpen={onOpen} />
            ))}
          </div>
        )}
        {info.kind === "agent" && !linked.length && tool.childIds?.length ? (
          <p className="text-xs leading-5 text-muted-foreground">
            子 Agent 已记录，暂未找到对应的本机对话文件。同步历史后可查看详情。
          </p>
        ) : null}
        {item.nested.length > 0 && depth < 4 && (
          <div>
            <p className="mb-3 text-xs font-medium">子 Agent 执行记录</p>
            <Transcript
              items={item.nested}
              task={task}
              childTasks={childTasks}
              onOpen={onOpen}
              onOpenFile={onOpenFile}
              depth={depth + 1}
            />
          </div>
        )}
        <details className="text-[11px] text-muted-foreground">
          <summary className="w-fit cursor-pointer">原始事件</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3">
            {JSON.stringify(tool, null, 2)}
          </pre>
        </details>
      </div>
    </details>
  );
  return files.length ? (
    <EditFileCard files={files} project={task.project} onOpen={onOpenFile}>
      {disclosure}
    </EditFileCard>
  ) : command ? (
    <ContextActions
      actions={[
        {
          label: "复制命令",
          disabled: !parsedCommands?.calls.some((call) => call.command),
          action: () =>
            void copyText(
              parsedCommands!.calls
                .flatMap((call) => (call.command ? [call.command] : []))
                .join("\n"),
            ),
        },
        {
          label: "复制执行结果",
          disabled: tool.output == null,
          action: () => void copyText(plain(tool.output)),
        },
      ]}
    >
      {disclosure}
    </ContextActions>
  ) : (
    disclosure
  );
}
function Prose({ text, user = false }: { text: string; user?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const long = user && text.length > 700;
  const [selection, setSelection] = useState("");
  return (
    <ContextActions
      onOpen={() => setSelection(window.getSelection()?.toString() || "")}
      actions={[
        {
          label: "复制所选文本",
          disabled: !selection,
          action: () => void copyText(selection),
        },
        { label: "复制整条消息", action: () => void copyText(text) },
      ]}
    >
      <div tabIndex={0}>
        <div className="markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              img: ({ alt }) => (
                <span className="text-muted-foreground">
                  [图片：{alt || "附件"}]
                </span>
              ),
              a: ({ children }) => (
                <span className="underline">{children}</span>
              ),
            }}
          >
            {long && !expanded ? `${text.slice(0, 700)}…` : text}
          </ReactMarkdown>
        </div>
        {long && (
          <Button
            variant="ghost"
            size="xs"
            className="mt-2 px-0 text-muted-foreground"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "收起消息" : "展开完整消息"}
          </Button>
        )}
      </div>
    </ContextActions>
  );
}
function ActivityGroup({
  items,
  task,
  childTasks,
  onOpen,
  onOpenFile,
  depth,
}: {
  items: TranscriptItem[];
  task: Task;
  childTasks: Task[];
  onOpen: (t: Task) => void;
  onOpenFile?: OpenProjectFile;
  depth: number;
}) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const id = useId();
  const reduced = useReducedMotion();
  const tools = items.filter((i) => i.kind === "tool");
  const failed = tools.filter(
    (i) => i.tool.state === "failed" || (exitCode(i.tool.output) ?? 0) !== 0,
  ).length;
  const pending = tools.filter(
    (i) => i.tool.state === "called" || i.tool.state === "running",
  );
  const running = task.status === "running" && pending.length > 0;
  const latest = running
    ? describeTool(pending[pending.length - 1].tool)
    : undefined;
  const open = manualOpen ?? true;
  // A single call is already a compact disclosure; avoid an extra nesting level.
  if (items.length === 1 && tools.length === 1)
    return (
      <ToolStep
        item={tools[0]}
        task={task}
        childTasks={childTasks}
        onOpen={onOpen}
        onOpenFile={onOpenFile}
        depth={depth}
      />
    );
  return (
    <div className="my-3">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setManualOpen(!open)}
        className="h-auto max-w-full justify-start gap-2 px-1 py-2 text-xs font-normal text-muted-foreground"
      >
        {running ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
        ) : failed ? (
          <TriangleAlert className="size-3.5 shrink-0 text-destructive" />
        ) : (
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 transition-transform",
              open && "rotate-90",
            )}
          />
        )}
        <span className="shrink-0">
          {tools.length ? `执行过程 · ${tools.length} 步` : "思考与运行记录"}
        </span>
        {failed > 0 && (
          <span className="shrink-0 text-destructive">{failed} 项失败</span>
        )}
        {latest && (
          <span className="truncate">
            {latest.title} {latest.detail}
          </span>
        )}
        {!running && pending.length > 0 && (
          <span className="shrink-0">{pending.length} 项未记录结果</span>
        )}
      </Button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={id}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.16 }}
            className="overflow-hidden"
          >
            <div className="ml-2 space-y-2 border-l py-2 pl-4">
              {items.map((item) =>
                item.kind === "tool" ? (
                  <ToolStep
                    key={item.key}
                    item={item}
                    task={task}
                    childTasks={childTasks}
                    onOpen={onOpen}
                    onOpenFile={onOpenFile}
                    depth={depth}
                  />
                ) : (
                  <details
                    key={item.key}
                    className="py-2 text-xs text-muted-foreground"
                  >
                    <summary className="cursor-pointer">
                      {item.message.role === "reasoning"
                        ? "思考记录"
                        : "运行记录"}
                    </summary>
                    <div className="mt-3 whitespace-pre-wrap break-words leading-6">
                      {item.message.text}
                    </div>
                  </details>
                ),
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
export function Transcript({
  items,
  task,
  childTasks,
  onOpen,
  onOpenFile,
  depth = 0,
}: {
  items: TranscriptItem[];
  task: Task;
  childTasks: Task[];
  onOpen: (task: Task) => void;
  onOpenFile?: OpenProjectFile;
  depth?: number;
}) {
  // One identity per response, with adjacent execution records grouped in place.
  const turns: { key: string; user: boolean; items: TranscriptItem[] }[] = [];
  for (const item of items) {
    const user = item.kind === "message" && item.message.role === "user";
    const last = turns[turns.length - 1];
    const handoff = item.kind === "message" && item.message.role === "handoff";
    const afterHandoff = last?.items.some(
      (i) => i.kind === "message" && i.message.role === "handoff",
    );
    if (user || handoff || afterHandoff || !last || last.user)
      turns.push({ key: item.key, user, items: [item] });
    else last.items.push(item);
  }
  return (
    <div className="space-y-8">
      {turns.map((turn) => {
        const notice = turn.items[0];
        if (notice.kind === "message" && notice.message.role === "handoff")
          return (
            <p
              key={turn.key}
              className="border-t pt-4 text-center text-xs text-muted-foreground"
            >
              {notice.message.text}
            </p>
          );
        const groups: {
          key: string;
          activity: boolean;
          items: TranscriptItem[];
        }[] = [];
        for (const item of turn.items) {
          const activity =
            item.kind === "tool" ||
            ["system", "reasoning"].includes(item.message.role);
          const last = groups[groups.length - 1];
          if (activity && last?.activity) last.items.push(item);
          else groups.push({ key: item.key, activity, items: [item] });
        }
        const turnAgent = turn.items.find(
          (i) => i.kind === "message" && i.message.agentKind,
        );
        const kind =
          turnAgent?.kind === "message"
            ? turnAgent.message.agentKind || task.agentKind
            : task.agentKind;
        return (
          <section
            key={turn.key}
            aria-label={turn.user ? "你的消息" : "Agent 回复"}
            className={cn(
              "min-w-0",
              turn.user &&
                "ml-auto w-fit max-w-[92%] rounded-2xl bg-secondary px-4 py-3 sm:max-w-[85%]",
            )}
          >
            {!turn.user && (
              <div className="mb-4 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <AgentIcon kind={kind} className="size-4" />
                {task.subagentName || agentNames[kind] || "Agent"}
              </div>
            )}
            <div className="space-y-4">
              {groups.map((group) =>
                group.activity ? (
                  <ActivityGroup
                    key={group.key}
                    items={group.items}
                    task={task}
                    childTasks={childTasks}
                    onOpen={onOpen}
                    onOpenFile={onOpenFile}
                    depth={depth}
                  />
                ) : (
                  group.items.map(
                    (item) =>
                      item.kind === "message" && (
                        <Prose
                          key={item.key}
                          text={item.message.text}
                          user={turn.user}
                        />
                      ),
                  )
                ),
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
