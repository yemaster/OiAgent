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
  for (const name of ["允许本次", "拒绝", "停止任务"])
    expect(screen.getByRole("button", { name, exact: true })).toBeDisabled();
});

it("keeps commands readable and groups optional parameters", async () => {
  render(
    <ApprovalCard
      request={{
        ...request,
        input: {
          command: ["/bin/zsh", "-lc", "npm test && git diff"],
          description: "检查测试和修改",
          cwd: "/work/project",
          timeout: 120000,
          run_in_background: false,
        },
      }}
      busy={false}
      onAnswer={vi.fn()}
      onStop={vi.fn()}
    />,
  );
  expect(screen.getByText("npm test && git diff")).toBeVisible();
  expect(screen.getByText("/work/project")).toBeVisible();
  expect(screen.getByText("检查测试和修改")).toBeVisible();
  expect(screen.getByRole("button", { name: "复制命令" })).toBeVisible();
  await userEvent.click(screen.getByText("更多参数 · 2"));
  expect(screen.getByText("120 秒")).toBeVisible();
  expect(screen.getByText("否")).toBeVisible();
});
it("shows empty replacements and preserves JSON file contents verbatim", () => {
  render(
    <ApprovalCard
      request={{
        ...request,
        tool: "Edit",
        reason: "",
        input: {
          file_path: "/work/a.json",
          old_string: '{"text":"keep exact"}',
          new_string: "",
        },
      }}
      busy={false}
      onAnswer={vi.fn()}
      onStop={vi.fn()}
    />,
  );
  expect(screen.getByText('{"text":"keep exact"}')).toBeVisible();
  expect(screen.getByText("（空）")).toBeVisible();
  expect(screen.getByText("修改前")).toBeVisible();
  expect(screen.getByText("修改后")).toBeVisible();
});
