import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ApprovalCard } from "@/components/workspace/ApprovalCard";
import { approvalQuestions, type Approval } from "@/lib/approvals";
const request: Approval = {
  id: "approval",
  tool: "Bash",
  input: { command: "git status --short", cwd: "/work/project" },
  reason: "需要读取工作区状态",
  createdAt: "",
  agentKind: "claude",
};
it("shows the command and replies only to this operation", async () => {
  const onAnswer = vi.fn(),
    onStop = vi.fn();
  render(
    <ApprovalCard
      request={request}
      busy={false}
      onAnswer={onAnswer}
      onStop={onStop}
    />,
  );
  expect(screen.getAllByText("git status --short")[0]).toBeVisible();
  expect(onAnswer).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "允许本次" }));
  expect(onAnswer).toHaveBeenCalledWith({ action: "allow" });
  await userEvent.click(screen.getByText("拒绝原因（可选）"));
  await userEvent.type(screen.getByLabelText("拒绝原因"), "请先解释用途");
  await userEvent.click(
    screen.getByRole("button", { name: "拒绝", exact: true }),
  );
  expect(onAnswer).toHaveBeenLastCalledWith({
    action: "deny",
    message: "请先解释用途",
  });
  await userEvent.click(screen.getByRole("button", { name: "停止任务" }));
  expect(onStop).toHaveBeenCalledOnce();
});
it("requires an explicit answer and retains question keys expected by Claude", async () => {
  const onAnswer = vi.fn();
  const question = {
    ...request,
    tool: "AskUserQuestion",
    input: {
      questions: [
        {
          question: "使用哪种数据库？",
          options: [
            { label: "SQLite", description: "保存在本地" },
            { label: "PostgreSQL" },
          ],
        },
      ],
    },
  };
  render(
    <ApprovalCard
      request={question}
      busy={false}
      onAnswer={onAnswer}
      onStop={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "提交回答" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: /SQLite/ }));
  await userEvent.click(screen.getByRole("button", { name: "提交回答" }));
  expect(onAnswer).toHaveBeenLastCalledWith({
    action: "allow",
    answers: { "使用哪种数据库？": "SQLite" },
  });
  await userEvent.type(
    screen.getByLabelText("使用哪种数据库？：补充回答"),
    "暂不使用数据库",
  );
  expect(screen.getByRole("button", { name: /SQLite/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await userEvent.click(screen.getByRole("button", { name: "提交回答" }));
  expect(onAnswer).toHaveBeenLastCalledWith({
    action: "allow",
    answers: { "使用哪种数据库？": "暂不使用数据库" },
  });
  expect(approvalQuestions({ ...question, agentKind: "qwen" })?.[0].key).toBe(
    "0",
  );
});
it("prevents duplicate actions while a response is being written", () => {
  render(
    <ApprovalCard request={request} busy onAnswer={vi.fn()} onStop={vi.fn()} />,
  );
  for (const button of screen.getAllByRole("button"))
    expect(button).toBeDisabled();
});
