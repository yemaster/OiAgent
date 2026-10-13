import { useState } from "react";
import { Check, ShieldQuestion, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { describeTool } from "@/lib/transcript";
import { ApprovalOperation } from "./ApprovalOperation";
import {
  approvalQuestions,
  type Approval,
  type ApprovalAnswer,
} from "@/lib/approvals";

export function ApprovalCard({
  request,
  busy,
  onAnswer,
  onStop,
}: {
  request: Approval;
  busy: boolean;
  onAnswer: (answer: ApprovalAnswer) => void;
  onStop: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const questions = approvalQuestions(request);
  const description = describeTool({
    callId: request.id,
    name: request.tool,
    input: request.input,
    output: null,
    state: "called",
  });
  const values = Object.fromEntries(
    (questions || []).map((q) => [
      q.key,
      [
        ...(answers[q.key] || []),
        ...(custom[q.key]?.trim() ? [custom[q.key].trim()] : []),
      ].join(", "),
    ]),
  );
  const invalid =
    questions !== null &&
    (!questions.length ||
      questions.some((q) => !q.title || !values[q.key]?.trim()));
  return (
    <section
      aria-label={questions ? "Agent 提问" : "操作审批"}
      className="space-y-4 rounded-lg border bg-background p-4"
    >
      <div className="flex items-start gap-2">
        <ShieldQuestion className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h3 className="text-sm font-medium">
            {questions ? "需要你的回答" : description.title}
          </h3>
        </div>
      </div>
      {questions && request.reason && (
        <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
          {request.reason}
        </p>
      )}
      {questions ? (
        questions.length ? (
          questions.map((q, index) => (
            <fieldset
              key={`${q.key}-${index}`}
              disabled={busy}
              className="space-y-2"
            >
              <legend className="mb-2 text-sm font-medium">
                {q.title}
                {q.multiple && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    可多选
                  </span>
                )}
              </legend>
              <div className="flex flex-col gap-2">
                {q.options.map((option) => (
                  <Button
                    key={option.label}
                    type="button"
                    variant="outline"
                    className="h-auto justify-start whitespace-normal px-3 py-2 text-left data-[selected=true]:border-ring data-[selected=true]:bg-accent"
                    data-selected={(answers[q.key] || []).includes(
                      option.label,
                    )}
                    aria-pressed={(answers[q.key] || []).includes(option.label)}
                    onClick={() => {
                      setAnswers((prev) => ({
                        ...prev,
                        [q.key]: q.multiple
                          ? (prev[q.key] || []).includes(option.label)
                            ? (prev[q.key] || []).filter(
                                (v) => v !== option.label,
                              )
                            : [...(prev[q.key] || []), option.label]
                          : [option.label],
                      }));
                      if (!q.multiple)
                        setCustom((prev) => ({ ...prev, [q.key]: "" }));
                    }}
                  >
                    <span>
                      <span className="block">{option.label}</span>
                      {option.description && (
                        <span className="mt-1 block text-xs font-normal text-muted-foreground">
                          {option.description}
                        </span>
                      )}
                    </span>
                  </Button>
                ))}
              </div>
              <Textarea
                aria-label={`${q.title}：补充回答`}
                placeholder={q.options.length ? "其他回答…" : "输入回答…"}
                maxLength={8000}
                value={custom[q.key] || ""}
                onChange={(e) => {
                  setCustom((prev) => ({ ...prev, [q.key]: e.target.value }));
                  if (!q.multiple)
                    setAnswers((prev) => ({ ...prev, [q.key]: [] }));
                }}
                className="min-h-16"
              />
            </fieldset>
          ))
        ) : (
          <p className="text-sm text-destructive">
            暂不支持此问题格式。可拒绝本次请求后进入原生终端。
          </p>
        )
      ) : (
        <ApprovalOperation request={request} />
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          拒绝原因（可选）
        </summary>
        <Label className="sr-only" htmlFor={`deny-${request.id}`}>
          拒绝原因
        </Label>
        <Textarea
          id={`deny-${request.id}`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={1000}
          placeholder="告诉 Agent 如何调整…"
          className="mt-2 min-h-16"
          disabled={busy}
        />
      </details>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={busy || invalid}
          onClick={() =>
            onAnswer({
              action: "allow",
              ...(questions ? { answers: values } : {}),
            })
          }
        >
          <Check />
          {questions ? "提交回答" : "允许本次"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onAnswer({ action: "deny", message })}
        >
          <X />
          {questions ? "跳过问题" : "拒绝"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          disabled={busy}
          onClick={onStop}
        >
          <Square />
          停止任务
        </Button>
      </div>
    </section>
  );
}
