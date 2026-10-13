import { CodeBlock } from "./CodeBlock";
import { codeLanguage } from "@/lib/codeLanguage";
import { describeTool, fieldName } from "@/lib/transcript";
import type { Approval } from "@/lib/approvals";

const labels: Record<string, string> = {
  timeout: "执行时限",
  timeout_ms: "执行时限",
  run_in_background: "后台运行",
  replace_all: "替换全部匹配",
  filePath: "文件",
  absolute_path: "文件",
  oldText: "修改前",
  newText: "修改后",
  edits: "修改内容",
  command_line: "命令",
};
function Value({ value }: { value: unknown }) {
  if (value == null)
    return <span className="text-muted-foreground">未设置</span>;
  if (typeof value === "boolean") return <span>{value ? "是" : "否"}</span>;
  if (Array.isArray(value))
    return (
      <ol className="list-inside list-decimal space-y-2">
        {value.map((item, i) => (
          <li key={i}>
            <Value value={item} />
          </li>
        ))}
      </ol>
    );
  if (typeof value === "object")
    return <Parameters entries={Object.entries(value)} />;
  return (
    <span className="whitespace-pre-wrap break-words">{String(value)}</span>
  );
}
function Parameters({ entries }: { entries: [string, unknown][] }) {
  return (
    <dl className="space-y-3 text-sm">
      {entries.map(([key, value]) => (
        <div key={key} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3">
          <dt className="text-xs leading-6 text-muted-foreground">
            {labels[key] || fieldName(key)}
          </dt>
          <dd className="min-w-0 max-h-64 overflow-auto text-sm leading-6">
            {(key === "timeout" || key === "timeout_ms") &&
            typeof value === "number" ? (
              `${value / 1000} 秒`
            ) : (
              <Value value={value} />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function ApprovalOperation({ request }: { request: Approval }) {
  const description = describeTool({
    name: request.tool,
    callId: request.id,
    input: request.input,
    output: null,
    state: "called",
  });
  const input = request.input;
  const hidden = new Set<string>();
  const purpose =
    typeof input.description === "string" ? input.description : "";
  if (purpose) hidden.add("description");
  const command = description.kind === "command" ? description.code : undefined;
  const commandKey = ["cmd", "command", "command_line"].find(
    (key) => input[key] != null,
  );
  if (command && commandKey) hidden.add(commandKey);
  const cwd = description.cwd;
  if (cwd) ["cwd", "workdir", "directory"].forEach((key) => hidden.add(key));
  const file = [
    "file_path",
    "filePath",
    "path",
    "absolute_path",
    "target_file",
  ].find((key) => typeof input[key] === "string");
  if (file) hidden.add(file);
  const before = input.old_string ?? input.oldText;
  const after = input.new_string ?? input.newText ?? input.content;
  const edit = description.kind === "edit";
  if (edit)
    ["old_string", "oldText", "new_string", "newText", "content"].forEach(
      (key) => hidden.add(key),
    );
  const rest = Object.entries(input).filter(([key]) => !hidden.has(key));
  const reason = request.reason !== purpose ? request.reason : "";
  return (
    <div className="space-y-3">
      {purpose && (
        <p className="whitespace-pre-wrap break-words text-sm">{purpose}</p>
      )}
      {command && (
        <CodeBlock
          label="命令"
          text={command}
          language="bash"
          copyLabel="复制命令"
        />
      )}
      {(cwd || file) && (
        <Parameters
          entries={[
            ...(cwd ? [["cwd", cwd] as [string, unknown]] : []),
            ...(file ? [["file_path", input[file]] as [string, unknown]] : []),
          ]}
        />
      )}
      {edit && (
        <div className="space-y-2">
          {before !== undefined && (
            <CodeBlock
              language={file ? codeLanguage(String(input[file])) : ""}
              label="修改前"
              copyLabel="复制修改前"
              text={
                typeof before === "string"
                  ? before
                  : JSON.stringify(before, null, 2)
              }
              tone="before"
            />
          )}
          {after !== undefined && (
            <CodeBlock
              language={file ? codeLanguage(String(input[file])) : ""}
              label={before === undefined ? "写入内容" : "修改后"}
              copyLabel={before === undefined ? "复制写入内容" : "复制修改后"}
              text={
                typeof after === "string"
                  ? after
                  : JSON.stringify(after, null, 2)
              }
              tone="after"
            />
          )}
        </div>
      )}
      {reason && (
        <p className="whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
          {reason}
        </p>
      )}
      {rest.length > 0 &&
        (command || (edit && (before !== undefined || after !== undefined)) ? (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              更多参数 · {rest.length}
            </summary>
            <div className="mt-3">
              <Parameters entries={rest} />
            </div>
          </details>
        ) : (
          <Parameters entries={rest} />
        ))}
    </div>
  );
}
