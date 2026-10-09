import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Choice } from "./shared";
import { mcpTemplate } from "@/lib/integrations";
export function McpEditor({
  kind,
  value,
  onChange,
}: {
  kind: string;
  value: string;
  onChange: (value: string) => void;
}) {
  let config: Record<string, unknown> = {};
  let valid = true;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      valid = false;
    else config = parsed as Record<string, unknown>;
  } catch {
    valid = false;
  }
  const remote =
    !config.command &&
    (typeof config.url === "string" || typeof config.httpUrl === "string");
  const update = (changes: Record<string, unknown>) =>
    onChange(JSON.stringify({ ...config, ...changes }, null, 2));
  const command = Array.isArray(config.command)
    ? String(config.command[0] || "")
    : String(config.command || "");
  const args = Array.isArray(config.command)
    ? config.command.slice(1)
    : Array.isArray(config.args)
      ? config.args
      : [];
  return (
    <div className="space-y-4">
      {valid && (
        <>
          <div className="space-y-2">
            <Label>连接方式</Label>
            <Choice
              label="MCP 连接方式"
              value={remote ? "remote" : "local"}
              onChange={(v) =>
                onChange(
                  JSON.stringify(mcpTemplate(kind, v === "remote"), null, 2),
                )
              }
              options={[
                { value: "local", label: "本地命令 · stdio" },
                { value: "remote", label: "远程地址 · HTTP / SSE" },
              ]}
            />
          </div>
          {remote ? (
            <div className="space-y-2">
              <Label htmlFor="mcp-url">服务地址</Label>
              <Input
                id="mcp-url"
                value={String(config.httpUrl || config.url || "")}
                onChange={(e) =>
                  update({
                    [config.httpUrl !== undefined ? "httpUrl" : "url"]:
                      e.target.value,
                  })
                }
                placeholder="https://example.com/mcp"
              />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="mcp-command">启动命令</Label>
                <Input
                  id="mcp-command"
                  value={command}
                  onChange={(e) =>
                    update({
                      command:
                        kind === "opencode"
                          ? [e.target.value, ...args]
                          : e.target.value,
                    })
                  }
                  placeholder="npx / uvx / 程序路径"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mcp-args">参数（每行一项）</Label>
                <Textarea
                  id="mcp-args"
                  className="min-h-20 font-mono text-xs"
                  value={args.join("\n")}
                  onChange={(e) => {
                    const next = e.target.value.split("\n");
                    update(
                      kind === "opencode"
                        ? { command: [command, ...next] }
                        : { args: next },
                    );
                  }}
                />
              </div>
            </>
          )}
          {["codex", "opencode"].includes(kind) && (
            <div className="flex items-center justify-between">
              <Label htmlFor="mcp-enabled">启用服务器</Label>
              <Switch
                id="mcp-enabled"
                checked={config.enabled !== false}
                onCheckedChange={(enabled) => update({ enabled })}
              />
            </div>
          )}
        </>
      )}
      <details
        open={!valid ? true : undefined}
        className="rounded-md border p-3"
      >
        <summary className="cursor-pointer text-xs font-medium">
          高级配置 · 环境变量、认证与完整 JSON
        </summary>
        <Textarea
          aria-label="MCP 原生配置"
          spellCheck={false}
          className="mt-3 min-h-56 font-mono text-xs leading-6"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {!valid && (
          <p className="mt-2 text-xs text-destructive">
            请输入有效的 JSON 对象。
          </p>
        )}
      </details>
    </div>
  );
}
