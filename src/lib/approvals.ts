import { record } from "./transcript";
export interface Approval {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  reason: string;
  createdAt: string;
  agentKind: string;
}
export interface ApprovalAnswer {
  action: "allow" | "deny";
  answers?: Record<string, string>;
  message?: string;
}
export function approvalQuestions(request: Approval) {
  if (!["AskUserQuestion", "ask_user_question"].includes(request.tool))
    return null;
  if (
    !Array.isArray(request.input.questions) ||
    request.input.questions.length > 12
  )
    return [];
  return request.input.questions.map((raw, index) => {
    const q = record(raw);
    return {
      key:
        request.agentKind === "qwen" ? String(index) : String(q.question || ""),
      title: String(q.question || ""),
      multiple: q.multiSelect === true,
      options: Array.isArray(q.options)
        ? q.options
            .map((raw) => {
              const option = record(raw);
              return {
                label: String(option.label || ""),
                description: String(option.description || ""),
              };
            })
            .filter((o) => o.label)
        : [],
    };
  });
}
