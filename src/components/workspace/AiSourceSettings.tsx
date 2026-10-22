import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Choice } from "./shared";
import { call, desktop } from "@/lib/api";
import type { Agent } from "@/lib/types";

type Source = { agentId: string; model: string; providerId: string | null };
const empty: Source = { agentId: "", model: "", providerId: null };
export function AiSourceSettings({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState("api");
  const [source, setSource] = useState<Source>(empty);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [providers, setProviders] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!desktop);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    void call<{
      source: Source;
      agents: Agent[];
      providers: { id: string; name: string }[];
    }>("ai_source_settings")
      .then((value) => {
        if (!disposed) {
          setSource(value.source);
          setKind(value.source.agentId ? "agent" : "api");
          setAgents(value.agents);
          setProviders(value.providers);
          setLoaded(true);
        }
      })
      .catch((error) => {
        if (!disposed) {
          setError(String(error));
          setLoaded(true);
        }
      });
    return () => {
      disposed = true;
    };
  }, []);
  async function save(test = false) {
    setBusy(true);
    setError("");
    try {
      await call("set_ai_source", { source: kind === "api" ? empty : source });
      if (test) await call("test_llm");
      toast.success(test ? "连接成功" : "已保存 AI 来源");
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  const agent = agents.find((a) => a.id === source.agentId);
  return (
    <div className="space-y-5">
      <Card className="gap-0 rounded-lg py-0 shadow-none">
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center justify-between gap-4">
            <Label>AI 来源</Label>
            <Choice
              label="AI 来源"
              value={kind}
              onChange={(value) => {
                setKind(value);
                setError("");
              }}
              disabled={!loaded || busy}
              options={[
                { value: "api", label: "LLM API" },
                { value: "agent", label: "已安装的 Agent" },
              ]}
            />
          </div>
          {kind === "agent" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Agent</Label>
                <Choice
                  className="w-full"
                  label="AI 服务 Agent"
                  value={source.agentId || "none"}
                  disabled={busy}
                  onChange={(id) =>
                    setSource({
                      agentId: id === "none" ? "" : id,
                      model: "",
                      providerId: null,
                    })
                  }
                  options={[
                    { value: "none", label: "选择 Agent" },
                    ...agents.map((a) => ({ value: a.id, label: a.name })),
                  ]}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ai-source-model">模型</Label>
                <Input
                  id="ai-source-model"
                  value={source.model}
                  disabled={busy}
                  placeholder="使用 Agent 默认模型"
                  onChange={(e) =>
                    setSource({ ...source, model: e.target.value })
                  }
                />
              </div>
              {agent?.kind === "claude" && (
                <div className="space-y-2 sm:col-span-2">
                  <Label>API 配置</Label>
                  <Choice
                    className="w-full"
                    label="AI 服务 Claude API 配置"
                    value={source.providerId || "default"}
                    disabled={busy}
                    onChange={(value) =>
                      setSource({
                        ...source,
                        providerId: value === "default" ? null : value,
                      })
                    }
                    options={[
                      { value: "default", label: "Claude Code 默认配置" },
                      ...providers.map((p) => ({ value: p.id, label: p.name })),
                    ]}
                  />
                </div>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            {kind === "agent" && (
              <Button
                variant="outline"
                disabled={!desktop || busy || !source.agentId}
                onClick={() => void save(true)}
              >
                测试连接
              </Button>
            )}
            <Button
              disabled={
                !desktop ||
                !loaded ||
                busy ||
                (kind === "agent" && !source.agentId)
              }
              onClick={() => void save()}
            >
              保存来源
            </Button>
          </div>
        </CardContent>
      </Card>
      {kind === "api" && children}
    </div>
  );
}
