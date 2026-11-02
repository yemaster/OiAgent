import { ConversationRevealContext } from "@/lib/conversationReveal";
import { RecordDisclosure } from "./RecordDisclosure";
import { subagentDescription } from "@/lib/subagentDescription";
import { ReasoningRecord } from "./ReasoningRecord";
import { isContextRecord } from "@/lib/contextRecords";
import remarkBreaks from "remark-breaks";
import {
  copyMessageSelection,
  selectedMessageText,
} from "@/lib/messageClipboard";
import { AttachmentList } from "./Attachments";
import { ConversationSearchContext } from "@/lib/conversationSearch";
import { isCompaction, compactionOutcome } from "@/lib/compaction";
import { CompactionStatus } from "./CompactionStatus";
import { codeLanguage } from "@/lib/codeLanguage";
import { CodeBlock, MarkdownCodeBlock } from "./CodeBlock";
import { ContextActions } from "./ContextActions";
import { copyText } from "@/lib/clipboard";
import { call, desktop } from "@/lib/api";
import {
  confirmExternalLinks,
  setConfirmExternalLinks,
} from "@/lib/linkPreferences";
import {
  conversationLink,
  remarkFileLinks,
  remarkRelativeLinks,
} from "@/lib/conversationLinks";
import { conversationImage } from "@/lib/conversationImages";
import { ConversationImage } from "./ConversationImage";
import { EditFileCard } from "./EditFileCard";
import { editedFiles, type OpenProjectFile } from "@/lib/editFiles";
import { CommandExecution } from "./CommandRecord";
import { memo, useContext, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Circle,
  Copy,
  Pencil,
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
  notification: Workflow,
};
const toolTones: Partial<Record<keyof typeof icons, string>> = {
  edit: "text-amber-700 dark:text-amber-400",
  plan: "text-sky-700 dark:text-sky-400",
  agent: "text-violet-600 dark:text-violet-400",
};
function Code({
  children,
  diff = false,
  language = "",
}: {
  children: string;
  diff?: boolean;
  language?: string;
}) {
  return <CodeBlock text={children} language={diff ? "diff" : language} />;
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
  language = "",
}: {
  value: unknown;
  depth?: number;
  language?: string;
}) {
  const v = language && typeof value === "string" ? value : decode(value);
  if (v == null) return null;
  if (typeof v !== "object")
    return (
      <Code
        language={language}
        diff={typeof v === "string" && v.includes("*** Begin Patch")}
      >
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
          <ToolValue
            key={i}
            value={item}
            depth={depth + 1}
            language={language}
          />
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
  if (o.text != null)
    return <ToolValue value={o.text} depth={depth + 1} language={language} />;
  const keys = Object.keys(o).filter(
    (k) => !hiddenFields.has(k) && o[k] != null && o[k] !== "",
  );
  if (!keys.length)
    return <p className="text-xs text-muted-foreground">无文本输出</p>;
  if (
    keys.length === 1 &&
    ["output", "content", "result", "response", "stdout"].includes(keys[0])
  )
    return (
      <ToolValue value={o[keys[0]]} depth={depth + 1} language={language} />
    );
  return (
    <dl className="space-y-3">
      {keys.map((k) => (
        <div key={k}>
          <dt className="mb-1.5 text-xs font-medium text-muted-foreground">
            {fieldName(k)}
          </dt>
          <dd>
            <ToolValue value={o[k]} depth={depth + 1} language={language} />
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
        {subagentDescription(task) || "暂无消息"}
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
function TaskNotification({
  item,
  expanded = false,
  task,
  linked,
  onOpen,
  onOpenFile,
}: {
  expanded?: boolean;
  item: Extract<TranscriptItem, { kind: "tool" }>;
  task: Task;
  linked: Task[];
  onOpen: (task: Task) => void;
  onOpenFile?: OpenProjectFile;
}) {
  const [open, setOpen] = useState(false);
  const input = record(item.tool.input);
  const output = record(item.tool.output);
  const stopped = ["stopped", "cancelled", "killed"].includes(
    plain(input.status),
  );
  const failed = item.tool.state === "failed";
  const pending = item.tool.state === "running";
  const running = pending && isActive(task);
  const status = stopped
    ? "已停止"
    : failed
      ? "失败"
      : running
        ? "进行中"
        : pending
          ? "未记录结果"
          : "已完成";
  const Icon =
    stopped || (pending && !running)
      ? Circle
      : failed
        ? TriangleAlert
        : running
          ? LoaderCircle
          : Check;
  const summary = plain(output.summary || input.description);
  const result = plain(output.result);
  const outputFile = plain(output.outputFile);
  const fileLink = conversationLink(outputFile, task.project);
  const tokens = record(output.usage).total_tokens;
  return (
    <details
      className="group/notification my-2 rounded-lg border border-border/60"
      data-tool-id={item.tool.callId}
      open={open || expanded}
    >
      <summary
        onClick={(event) => {
          event.preventDefault();
          setOpen(!open);
        }}
        className="flex cursor-pointer list-none items-start gap-2.5 rounded-lg px-3 py-2.5 text-xs transition-colors hover:bg-muted/40 [&::-webkit-details-marker]:hidden"
      >
        <Icon
          className={cn(
            "mt-0.5 size-3.5 shrink-0 text-muted-foreground",
            running && "animate-spin",
            failed && "text-destructive",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-medium">后台任务</span>
            <span
              className={cn(
                "text-muted-foreground",
                failed && "text-destructive",
              )}
            >
              {status}
            </span>
          </span>
          {summary && (
            <span className="mt-1 block line-clamp-2 whitespace-pre-wrap leading-5 text-muted-foreground">
              {summary}
            </span>
          )}
        </span>
        <ChevronRight className="mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform group-open/notification:rotate-90" />
      </summary>
      {(open || expanded) && (
        <div className="space-y-3 border-t border-border/60 px-3 py-3 text-xs">
          {(result || summary) && (
            <Prose
              text={result || summary}
              project={task.project}
              remote={!!task.deviceId}
              imageAttachments={task.attachments}
              onOpenFile={onOpenFile}
            />
          )}
          {outputFile &&
            (fileLink?.kind === "file" && onOpenFile ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-auto max-w-full justify-start px-0 text-xs"
                onClick={() =>
                  onOpenFile(
                    task.project,
                    fileLink.path,
                    "edit",
                    undefined,
                    fileLink.location,
                  )
                }
              >
                <FileText className="size-3.5 shrink-0" />
                <span className="truncate">{outputFile}</span>
              </Button>
            ) : (
              <p className="break-all text-muted-foreground">
                输出文件：{outputFile}
              </p>
            ))}
          {linked.map((child) => (
            <SubagentCard key={child.id} task={child} onOpen={onOpen} />
          ))}
          <div className="flex items-center gap-3 text-muted-foreground">
            <span className="min-w-0 truncate" title={plain(input.taskId)}>
              {plain(input.taskId)}
            </span>
            {typeof tokens === "number" && (
              <span className="shrink-0">{compact(tokens)} tokens</span>
            )}
            {(result || summary) && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="ml-auto"
                aria-label="复制任务结果"
                onClick={() => void copyText(result || summary)}
              >
                <Copy className="size-3" />
              </Button>
            )}
          </div>
        </div>
      )}
    </details>
  );
}
function ToolStep(props: Parameters<typeof ToolStepContent>[0]) {
  const search = useContext(ConversationSearchContext);
  const selected =
    search?.path.length === props.depth + 1 &&
    search.path[props.depth] === props.item.key;
  return (
    <div
      data-search-match={selected || undefined}
      className={selected ? "rounded-md bg-accent/40" : undefined}
      data-conversation-key={props.depth === 0 ? props.item.key : undefined}
    >
      <ToolStepContent {...props} />
    </div>
  );
}
function ToolStepContent({
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
  const search = useContext(ConversationSearchContext);
  const reveal = useContext(ConversationRevealContext);
  const { tool } = item;
  const info = useMemo(() => describeTool(tool), [tool]);
  const Icon = icons[info.kind];
  const code = exitCode(tool.output);
  const failed = tool.state === "failed" || (code !== undefined && code !== 0);
  const running =
    !failed &&
    (tool.state === "running" || tool.state === "called") &&
    isActive(task);
  const done = tool.state === "completed" && !failed;
  // Only actual execution containers expand automatically; leaf calls stay compact.
  // Child messages are results, not execution groups. Delegated agents keep
  // their own transcript behind the disclosure even when their tools stream in.
  const expanded =
    reveal?.key === item.key ||
    search?.path[depth] === item.key ||
    (manualOpen ??
      (info.kind !== "agent" &&
        item.nested.some((child) => child.kind === "tool") &&
        depth < 4));
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
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已复制");
    } catch {
      toast.error("复制失败，请手动选择文本复制");
    }
  }
  const files = useMemo(
    () => (info.kind === "edit" ? editedFiles(tool, task.project) : []),
    [info.kind, tool, task.project],
  );
  if (info.kind === "notification")
    return (
      <TaskNotification
        item={item}
        expanded={search?.path[depth] === item.key}
        task={task}
        linked={linked}
        onOpen={onOpen}
        onOpenFile={onOpenFile}
      />
    );
  if (info.kind === "command")
    return (
      <CommandExecution
        tool={tool}
        id={tool.callId}
        project={task.project}
        open={search?.path[depth] === item.key || (manualOpen ?? false)}
        onOpen={setManualOpen}
        state={
          failed
            ? "failed"
            : running
              ? "running"
              : done
                ? "completed"
                : "unknown"
        }
        exitCode={code}
      >
        {item.nested.length > 0 &&
          (depth < 4 || search?.path[depth] === item.key) && (
            <ConversationSearchContext.Provider
              value={search?.path[depth] === item.key ? search : null}
            >
              <Transcript
                items={item.nested}
                task={task}
                childTasks={childTasks}
                onOpen={onOpen}
                onOpenFile={onOpenFile}
                depth={depth + 1}
              />
            </ConversationSearchContext.Provider>
          )}
      </CommandExecution>
    );
  const disclosure = (
    <details
      className="group/step my-1"
      data-tool-id={tool.callId || undefined}
      open={expanded}
    >
      <summary
        onClick={(e) => {
          e.preventDefault();
          reveal?.dismiss();
          setManualOpen(!expanded);
        }}
        className="flex cursor-pointer list-none items-center gap-2 rounded-md px-1 py-2 text-xs transition-colors hover:bg-muted/60 [&::-webkit-details-marker]:hidden"
      >
        <Icon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground",
            toolTones[info.kind],
          )}
        />
        <span className="shrink-0 font-medium">{info.title}</span>
        <span
          className="min-w-0 flex-1 truncate text-muted-foreground"
          title={info.detail}
        >
          {info.detail}
        </span>
        <span
          className={cn(
            "ml-2 flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground",
            failed && "text-destructive",
            running && "text-sky-700 dark:text-sky-400",
            done && "text-emerald-700 dark:text-emerald-400",
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
      {expanded && (
        <div className="mb-4 ml-2.5 max-h-[min(32rem,50dvh)] space-y-4 overflow-y-auto overscroll-contain border-l pl-4 pt-2">
          {tool.input != null && (
            <section aria-label="执行内容">
              {info.kind === "plan" && Array.isArray(plan) ? (
                <ul className="space-y-2">
                  {plan.map((p, i) => {
                    const row = record(p);
                    return (
                      <li key={i} className="flex items-start gap-2 text-xs">
                        {row.status === "completed" ||
                        row.completed === true ? (
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
              <ToolValue
                value={tool.output}
                language={info.kind === "read" ? codeLanguage(info.detail) : ""}
              />
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
              子 Agent
              已记录，暂未找到对应的本机对话文件。同步历史后可查看详情。
            </p>
          ) : null}
          {item.nested.length > 0 &&
            (depth < 4 || search?.path[depth] === item.key) && (
              <div>
                <p className="mb-3 text-xs font-medium">子 Agent 执行记录</p>
                <ConversationSearchContext.Provider
                  value={search?.path[depth] === item.key ? search : null}
                >
                  <Transcript
                    items={item.nested}
                    task={task}
                    childTasks={childTasks}
                    onOpen={onOpen}
                    onOpenFile={onOpenFile}
                    depth={depth + 1}
                  />
                </ConversationSearchContext.Provider>
              </div>
            )}
          <RawToolEvent tool={tool} />
        </div>
      )}
      {expanded && (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            reveal?.dismiss();
            setManualOpen(false);
          }}
        >
          收起
        </Button>
      )}
    </details>
  );
  return files.length ? (
    <EditFileCard
      files={files}
      tool={tool}
      project={task.project}
      onOpen={onOpenFile}
    >
      {disclosure}
    </EditFileCard>
  ) : (
    disclosure
  );
}
function RawToolEvent({ tool }: { tool: import("@/lib/types").ToolEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="text-[11px] text-muted-foreground" open={open}>
      <summary
        className="w-fit cursor-pointer"
        onClick={(event) => {
          event.preventDefault();
          setOpen(!open);
        }}
      >
        原始事件
      </summary>
      {open && (
        <CodeBlock
          text={JSON.stringify(tool, null, 2)}
          language="json"
          label="JSON"
          copyLabel="复制原始事件"
        />
      )}
    </details>
  );
}
export const Prose = memo(
  function Prose({
    selected = false,
    attachments,
    imageAttachments = attachments,
    remote = false,
    anchorKey,
    basePath,
    text,
    user = false,
    project,
    onOpenFile,
  }: {
    text: string;
    attachments?: import("@/lib/types").Attachment[];
    imageAttachments?: import("@/lib/types").Attachment[];
    remote?: boolean;
    anchorKey?: string;
    basePath?: string;
    selected?: boolean;
    user?: boolean;
    project: string;
    onOpenFile?: OpenProjectFile;
  }) {
    const [expanded, setExpanded] = useState(false);
    const [externalUrl, setExternalUrl] = useState("");
    const [externalOpen, setExternalOpen] = useState(false);
    const [rememberLink, setRememberLink] = useState(false);
    const rememberLinkId = useId();
    const [opening, setOpening] = useState(false);
    const openingRef = useRef(false);
    const proseRoot = useRef<HTMLDivElement | null>(null);
    const linkTrigger = useRef<HTMLAnchorElement | null>(null);
    const cancelLink = useRef<HTMLButtonElement | null>(null);
    async function openExternal(url: string, remember = false) {
      if (openingRef.current) return;
      openingRef.current = true;
      setOpening(true);
      try {
        if (desktop) await call("open_conversation_link", { url });
        else window.open(url, "_blank", "noopener,noreferrer");
        if (remember) {
          try {
            setConfirmExternalLinks(false);
          } catch {
            toast.error("链接已打开，但偏好未保存");
          }
        }
        setExternalOpen(false);
      } catch (error) {
        toast.error(String(error));
      } finally {
        openingRef.current = false;
        setOpening(false);
      }
    }
    function requestExternal(url: string, trigger: HTMLAnchorElement) {
      if (openingRef.current) return;
      if (!confirmExternalLinks()) {
        void openExternal(url);
        return;
      }
      linkTrigger.current = trigger;
      setExternalUrl(url);
      setRememberLink(false);
      setExternalOpen(true);
    }
    const plugins = useMemo(
      () => [
        remarkGfm,
        ...(user ? [remarkBreaks] : []),
        remarkFileLinks(project),
        ...(basePath ? [remarkRelativeLinks(basePath)] : []),
      ],
      [project, user, basePath],
    );
    const long = user && text.length > 700;
    const [selection, setSelection] = useState("");
    return (
      <ContextActions
        onOpen={() => setSelection(selectedMessageText())}
        actions={[
          {
            label: "复制所选文本",
            disabled: !selection,
            action: () => void copyText(selection),
          },
          { label: "复制整条消息", action: () => void copyText(text) },
        ]}
      >
        <div
          ref={proseRoot}
          tabIndex={0}
          data-conversation-key={anchorKey}
          data-search-match={selected || undefined}
          className={selected ? "rounded-md bg-accent/40" : undefined}
        >
          {!!attachments?.length && (
            <AttachmentList items={attachments} remote={remote} />
          )}
          <div className="markdown" onCopy={copyMessageSelection}>
            <ReactMarkdown
              remarkPlugins={plugins}
              urlTransform={(url, key, node) =>
                (
                  node.tagName === "img" && key === "src"
                    ? conversationImage(url, project, imageAttachments)
                    : conversationLink(url, project)
                )
                  ? url
                  : ""
              }
              components={{
                pre: MarkdownCodeBlock,
                img: ({ alt, src }) => (
                  <ConversationImage
                    key={`${project}:${src}:${remote}`}
                    src={typeof src === "string" ? src : ""}
                    alt={alt}
                    project={project}
                    attachments={imageAttachments}
                    remote={remote}
                  />
                ),
                a: ({ children, href }) => {
                  const target = conversationLink(href || "", project);
                  if (!target || (target.kind === "file" && !onOpenFile))
                    return <span>{children}</span>;
                  return (
                    <a
                      href={target.kind === "web" ? target.url : href}
                      target={target.kind === "web" ? "_blank" : undefined}
                      rel="noopener noreferrer"
                      className="cursor-pointer underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-current focus-visible:outline-2 focus-visible:outline-ring"
                      title={
                        target.kind === "web"
                          ? target.url
                          : `打开 ${target.path}${target.location ? `:${target.location.line}` : ""}`
                      }
                      onClick={(event) => {
                        event.preventDefault();
                        if (target.kind === "file") {
                          onOpenFile?.(
                            project,
                            target.path,
                            "edit",
                            undefined,
                            target.location,
                          );
                        } else {
                          requestExternal(target.url, event.currentTarget);
                        }
                      }}
                      onAuxClick={(event) => {
                        event.preventDefault();
                        if (event.button === 1 && target.kind === "web") {
                          requestExternal(target.url, event.currentTarget);
                        }
                      }}
                    >
                      {children}
                    </a>
                  );
                },
              }}
            >
              {long && !expanded && !selected ? `${text.slice(0, 700)}…` : text}
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
          <Dialog
            open={externalOpen}
            onOpenChange={(open) => {
              if (!openingRef.current) setExternalOpen(open);
            }}
          >
            <DialogContent
              className="gap-5 p-5 sm:max-w-md"
              showCloseButton={false}
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                cancelLink.current?.focus();
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                const link = linkTrigger.current?.isConnected
                  ? linkTrigger.current
                  : Array.from(
                      proseRoot.current?.querySelectorAll("a") || [],
                    ).find(
                      (element) => element.getAttribute("href") === externalUrl,
                    );
                link?.focus();
              }}
            >
              <DialogHeader>
                <DialogTitle className="break-all text-lg leading-snug">
                  前往{" "}
                  {externalUrl ? new URL(externalUrl).hostname : "外部网站"}？
                </DialogTitle>
                <DialogDescription className="max-h-20 overflow-y-auto break-all text-left text-xs leading-5 select-text">
                  {externalUrl}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="mx-0 mb-0 flex-col gap-4 border-0 bg-transparent p-0 sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <Switch
                    id={rememberLinkId}
                    size="sm"
                    checked={rememberLink}
                    onCheckedChange={setRememberLink}
                    disabled={opening}
                  />
                  <Label
                    htmlFor={rememberLinkId}
                    className="text-xs font-normal text-muted-foreground"
                  >
                    下次不再提示
                  </Label>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    ref={cancelLink}
                    variant="outline"
                    disabled={opening}
                    onClick={() => setExternalOpen(false)}
                  >
                    取消
                  </Button>
                  <Button
                    disabled={opening}
                    onClick={() => void openExternal(externalUrl, rememberLink)}
                  >
                    {opening ? "正在打开…" : "打开"}
                  </Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </ContextActions>
    );
  },
  (previous, next) => {
    const { imageAttachments: oldImages = [], ...oldProps } = previous;
    const { imageAttachments: newImages = [], ...newProps } = next;
    return (
      oldImages.length === newImages.length &&
      oldImages.every((image, index) => image === newImages[index]) &&
      Object.keys(oldProps).length === Object.keys(newProps).length &&
      (Object.keys(oldProps) as (keyof typeof oldProps)[]).every((key) =>
        Object.is(oldProps[key], newProps[key]),
      )
    );
  },
);
export const Transcript = memo(function Transcript({
  items,
  task,
  childTasks,
  onOpen,
  onOpenFile,
  depth = 0,
  visible = true,
  onEditMessage,
  editing,
}: {
  editing?: { index: number; anchor: (element: HTMLDivElement | null) => void };
  onEditMessage?: (index: number) => void;
  items: TranscriptItem[];
  task: Task;
  childTasks: Task[];
  onOpen: (task: Task) => void;
  onOpenFile?: OpenProjectFile;
  depth?: number;
  visible?: boolean;
}) {
  const search = useContext(ConversationSearchContext);
  const imageAttachments = useMemo(
    () => [
      ...(task.attachments || []),
      ...items.flatMap((item) =>
        item.kind === "message" ? item.message.attachments || [] : [],
      ),
    ],
    [items, task.attachments],
  );
  // One identity per response, with adjacent execution records grouped in place.
  const turns: { key: string; user: boolean; items: TranscriptItem[] }[] = [];
  for (const item of items) {
    const user = item.kind === "message" && item.message.role === "user";
    const last = turns[turns.length - 1];
    const handoff = item.kind === "message" && item.message.role === "handoff";
    const first = last?.items[0];
    const afterHandoff =
      first?.kind === "message" && first.message.role === "handoff";
    if (user || handoff || afterHandoff || !last || last.user)
      turns.push({ key: item.key, user, items: [item] });
    else last.items.push(item);
  }
  // Nested transcripts describe tool results, not the parent's live response.
  const responding =
    depth === 0 && task.status === "running" && task.deviceOnline !== false;
  const lastTurn = turns.at(-1);
  if (
    responding &&
    (!lastTurn ||
      lastTurn.user ||
      lastTurn.items.some(
        (item) => item.kind === "message" && item.message.role === "handoff",
      ))
  ) {
    turns.push({
      key: `pending-${lastTurn?.key || task.id}`,
      user: false,
      items: [],
    });
  }
  return (
    <div className="space-y-8">
      {turns.map((turn, index) => {
        const notice = turn.items[0];
        if (notice?.kind === "message" && notice.message.role === "handoff")
          return (
            <p
              key={turn.key}
              data-conversation-key={depth === 0 ? notice.key : undefined}
              data-search-match={
                search?.path[depth] === notice.key || undefined
              }
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
            item.kind === "tool"
              ? !isContextRecord(item.tool.name)
              : item.message.role === "reasoning";
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
        const editingTurn =
          !!editing &&
          depth === 0 &&
          turn.user &&
          turn.items.some(
            (item) =>
              item.kind === "message" &&
              item.message.sourceIndex === editing?.index,
          );
        return (
          <section
            key={turn.key}
            aria-label={turn.user ? "你的消息" : "Agent 回复"}
            data-conversation-key={depth === 0 ? turn.key : undefined}
            data-conversation-user={
              depth === 0 && turn.user ? "true" : undefined
            }
            className={cn(
              "group/message relative min-w-0",
              turn.user &&
                "ml-auto w-fit max-w-[92%] rounded-2xl bg-secondary px-4 py-3 sm:max-w-[85%]",
              editingTurn && "w-full max-w-full sm:max-w-full",
            )}
          >
            {turn.user &&
              depth === 0 &&
              onEditMessage &&
              !editingTurn &&
              turn.items[0]?.kind === "message" &&
              !turn.items[0].message.synthetic &&
              turn.items[0].message.sourceIndex !== undefined && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="编辑消息"
                  title="编辑消息"
                  disabled={!!editing}
                  className="absolute -left-9 top-1 size-7 text-muted-foreground opacity-0 transition-opacity group-hover/message:opacity-100 focus-visible:opacity-100"
                  onClick={() => {
                    const item = turn.items[0];
                    if (
                      item.kind === "message" &&
                      item.message.sourceIndex !== undefined
                    )
                      onEditMessage(item.message.sourceIndex);
                  }}
                >
                  <Pencil className="size-3.5" />
                </Button>
              )}
            {!turn.user && (
              <div className="mb-4 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <AgentIcon kind={kind} className="size-4" />
                {task.subagentName || agentNames[kind] || "Agent"}
              </div>
            )}
            {editingTurn ? (
              <div ref={editing?.anchor} data-conversation-key={turn.key} />
            ) : (
              <div className="space-y-4">
                {groups.map((group) =>
                  group.activity ? (
                    <div key={group.key} className="space-y-3">
                      {group.items.map((item) =>
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
                          <ReasoningRecord
                            visible={visible}
                            key={item.key}
                            message={item.message}
                            anchorKey={depth === 0 ? item.key : undefined}
                            selected={search?.path[depth] === item.key}
                            active={
                              responding &&
                              item === items.at(-1) &&
                              (item.message.reasoning
                                ? !item.message.reasoning.completed
                                : item.message.delta === true)
                            }
                            stoppedAt={task.updatedAt}
                          />
                        ),
                      )}
                    </div>
                  ) : (
                    group.items.map((item) =>
                      item.kind === "tool" && isCompaction(item.tool) ? (
                        <div
                          key={item.key}
                          data-conversation-key={
                            depth === 0 ? item.key : undefined
                          }
                          data-search-match={
                            search?.path[depth] === item.key || undefined
                          }
                        >
                          <CompactionStatus tool={item.tool} task={task} />
                        </div>
                      ) : item.kind === "tool" &&
                        item.tool.name === "skill_loaded" ? (
                        <div
                          key={item.key}
                          data-conversation-key={
                            depth === 0 ? item.key : undefined
                          }
                          data-search-match={
                            search?.path[depth] === item.key || undefined
                          }
                        >
                          <RecordDisclosure
                            title={`已读取 Skill${
                              record(item.tool.output).path
                                ? ` · ${String(record(item.tool.output).path)
                                    .replace(/[\\/]+$/, "")
                                    .split(/[\\/]/)
                                    .at(-1)}`
                                : ""
                            }`}
                            expanded={search?.path[depth] === item.key}
                          >
                            {() => (
                              <div className="whitespace-pre-wrap break-words">
                                {plain(record(item.tool.output).content)}
                              </div>
                            )}
                          </RecordDisclosure>
                        </div>
                      ) : (
                        item.kind === "message" && (
                          <Prose
                            key={item.key}
                            anchorKey={depth === 0 ? item.key : undefined}
                            selected={search?.path[depth] === item.key}
                            text={item.message.text}
                            attachments={item.message.attachments}
                            imageAttachments={imageAttachments}
                            remote={!!task.deviceId}
                            user={turn.user}
                            project={task.project}
                            onOpenFile={onOpenFile}
                          />
                        )
                      ),
                    )
                  ),
                )}
                {responding &&
                  index === turns.length - 1 &&
                  !turn.items.some(
                    (item) =>
                      item.kind === "tool" &&
                      isCompaction(item.tool) &&
                      compactionOutcome(item.tool) === "running",
                  ) && (
                    <span
                      role="status"
                      aria-label="Agent 正在回复"
                      className="inline-flex text-muted-foreground"
                    >
                      <LoaderCircle
                        aria-hidden="true"
                        className="size-4 motion-safe:animate-spin"
                      />
                    </span>
                  )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
});

export { Prose as ConversationText };
