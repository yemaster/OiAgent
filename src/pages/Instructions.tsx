import { useEffect, useState } from "react";
import { FileText, FolderOpen, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Choice, Empty, PageHeading } from "@/components/workspace/shared";
import { call, desktop, pickDirectory } from "@/lib/api";
import { agentNames, projectName, type Snapshot } from "@/lib/types";
import { integrationKinds, type IntegrationScope } from "@/lib/integrations";
export interface InstructionEntry {
  id: string;
  path: string;
  exists: boolean;
  description: string;
}
export interface InstructionTarget {
  scope: IntegrationScope;
  id: string;
}
export interface InstructionContext {
  kind: string;
  project: string;
}
export function InstructionsPage({
  snapshot,
  context,
  onContext,
  onOpen,
}: {
  snapshot: Snapshot;
  context: InstructionContext;
  onContext: (value: InstructionContext) => void;
  onOpen: (scope: IntegrationScope, entry: InstructionEntry) => void;
}) {
  const [files, setFiles] = useState<InstructionEntry[]>();
  const [error, setError] = useState("");
  const [revision, refresh] = useState(0);
  const { kind, project } = context;
  useEffect(() => {
    let ignore = false;
    // oxlint-disable-next-line react/set-state-in-effect
    setFiles(undefined);
    setError("");
    if (desktop)
      void call<InstructionEntry[]>("instruction_files", {
        scope: { kind, project: project === "user" ? null : project },
      })
        .then((rows) => {
          if (!ignore) setFiles(rows);
        })
        .catch((e) => {
          if (!ignore) setError(String(e));
        });
    return () => {
      ignore = true;
    };
  }, [kind, project, revision]);
  return (
    <div className="mx-auto w-full max-w-5xl p-5 lg:p-8">
      <PageHeading title="指令文件">
        <Button
          variant="outline"
          disabled={!desktop}
          onClick={() => refresh((v) => v + 1)}
        >
          <RefreshCw />
          刷新
        </Button>
      </PageHeading>
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <Label>Agent</Label>
          <Choice
            label="配置 Agent"
            value={kind}
            onChange={(kind) => onContext({ ...context, kind })}
            options={integrationKinds.map((value) => ({
              value,
              label: agentNames[value],
            }))}
          />
        </div>
        <div className="space-y-2">
          <Label>作用范围</Label>
          <Choice
            label="作用范围"
            value={project}
            onChange={(project) => onContext({ ...context, project })}
            options={[
              { value: "user", label: "用户 · 所有项目" },
              ...[
                ...new Set([
                  ...snapshot.projects,
                  ...(project !== "user" ? [project] : []),
                ]),
              ].map((value) => ({ value, label: projectName(value) })),
            ]}
          />
        </div>
        <Button
          variant="ghost"
          disabled={!desktop}
          onClick={async () => {
            try {
              const project = await pickDirectory();
              if (project) onContext({ ...context, project });
            } catch (e) {
              toast.error(String(e));
            }
          }}
        >
          <FolderOpen />
          选择项目
        </Button>
      </div>
      {!desktop ? (
        <Empty title="请在桌面版管理指令文件" />
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : !files ? (
        <p className="text-sm text-muted-foreground">正在读取指令文件…</p>
      ) : (
        <>
          <div className="divide-y rounded-lg border">
            {files.map((file) => (
              <div key={file.id} className="flex items-center gap-4 p-4">
                <FileText className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">{file.id}</span>
                    <span className="text-xs text-muted-foreground">
                      {file.exists ? "已存在" : "未创建"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {file.description}
                  </p>
                  <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                    {file.path}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onOpen(
                      { kind, project: project === "user" ? null : project },
                      file,
                    )
                  }
                >
                  {file.exists ? "编辑" : "创建"}
                </Button>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs leading-6 text-muted-foreground">
            在文件标签中编辑，保存后写入原生配置。这里只列出当前范围的常用文件；父目录、子目录和导入文件的加载规则由
            Agent 决定。已有会话请按 CLI 的方式重新加载指令，或开启新会话。
          </p>
          <details className="mt-6 text-sm">
            <summary className="cursor-pointer">指令文件写什么？</summary>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-xs leading-6 text-muted-foreground">
              <li>项目使用的构建、测试和检查命令。</li>
              <li>代码风格、目录约定和需要保留的兼容行为。</li>
              <li>修改后的验证步骤，以及需要先确认的操作。</li>
              <li>
                用户范围写个人习惯；项目范围写团队共同遵循的约定。不要填写 API
                Key。
              </li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
