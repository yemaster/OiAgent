import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { CommandExecution } from "@/components/workspace/CommandRecord";
import { Transcript } from "@/components/workspace/Transcript";
import { ConversationSearchContext } from "@/lib/conversationSearch";
import { buildTranscript } from "@/lib/transcript";
import { demoSnapshot } from "@/lib/demo";
import type { Message, ToolEvent } from "@/lib/types";

const tool: ToolEvent = {
  callId: "cmd",
  name: "exec_command",
  input: { cmd: "npm test", workdir: "/repo" },
  output: {
    exit_code: 0,
    stdout: "all checks passed",
    stderr: "warning: slow test",
  },
  state: "completed",
};
const props = {
  tool,
  project: "/repo",
  id: "cmd",
  open: false,
  onOpen: vi.fn(),
  state: "completed" as const,
  exitCode: 0,
};

it("uses one summary line, then one terminal area without repeated labels or metadata", async () => {
  const user = userEvent.setup();
  const view = render(<CommandExecution {...props} />);
  expect(screen.getByText("已完成")).toBeVisible();
  expect(view.container.querySelectorAll("summary")).toHaveLength(1);
  expect(screen.queryByText("/repo")).not.toBeInTheDocument();
  expect(screen.queryByText("all checks passed")).not.toBeInTheDocument();
  await user.click(screen.getByText("npm test"));
  expect(props.onOpen).toHaveBeenCalledWith(true);
  view.rerender(<CommandExecution {...props} open />);
  expect(screen.getAllByRole("region", { name: "命令执行详情" })).toHaveLength(
    1,
  );
  expect(screen.getByText("$ npm test")).toBeVisible();
  expect(screen.getByText(/all checks passed/)).toHaveTextContent(
    "warning: slow test",
  );
  for (const label of [
    "执行内容",
    "执行结果",
    "原始调用",
    "原始事件",
    "退出码 0",
    "/repo",
  ])
    expect(screen.queryByText(label)).not.toBeInTheDocument();
  expect(screen.getAllByRole("button")).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "复制执行记录" }));
  expect(await navigator.clipboard.readText()).toBe(
    "npm test\n\nall checks passed\nwarning: slow test",
  );
});

it("supports copying a collapsed command without rendering its output first", async () => {
  const user = userEvent.setup();
  render(<CommandExecution {...props} />);
  fireEvent.contextMenu(screen.getByText("npm test"));
  await user.click(screen.getByRole("menuitem", { name: "复制命令" }));
  expect(await navigator.clipboard.readText()).toBe("npm test");
  expect(
    screen.queryByRole("region", { name: "命令执行详情" }),
  ).not.toBeInTheDocument();
});

it("keeps unresolved scripts intact without inventing executed branches or adding explanatory prose", () => {
  const script =
    'if (shouldPublish) await tools.exec_command({cmd: "npm publish"});';
  render(
    <CommandExecution
      {...props}
      open
      tool={{ ...tool, name: "functions.exec", input: script }}
    />,
  );
  expect(screen.getByText("工具脚本")).toBeVisible();
  expect(screen.getByText(script)).toBeVisible();
  expect(screen.queryByText("$ npm publish")).not.toBeInTheDocument();
  expect(
    screen.queryByText(/静态|解析|条件调用|原始调用/),
  ).not.toBeInTheDocument();
});

it("keeps per-command working directories and stderr for a batch", () => {
  const script =
    'await tools.exec_command({cmd: "pwd", workdir: "/one"}); await tools.exec_command({cmd: "npm test", workdir: "/two"});';
  render(
    <CommandExecution
      {...props}
      open
      tool={{ ...tool, name: "functions.exec", input: script }}
    />,
  );
  expect(screen.getByText("2 条命令")).toBeVisible();
  expect(screen.getByText("/one")).toBeVisible();
  expect(screen.getByText("/two")).toBeVisible();
  expect(screen.getByText("$ pwd")).toBeVisible();
});

it("retains failure and incomplete-result states without displaying a success marker", () => {
  const view = render(
    <CommandExecution {...props} open state="failed" exitCode={2} />,
  );
  expect(screen.getByText("执行失败")).toBeVisible();
  expect(screen.getByText("退出码 2")).toBeVisible();
  view.rerender(
    <CommandExecution {...props} state="unknown" exitCode={undefined} />,
  );
  expect(screen.getByText("未记录结果")).toBeVisible();
  expect(screen.queryByText("已完成")).not.toBeInTheDocument();
});

it("preserves the visible execution list and only expands a matching command during search", () => {
  const messages: Message[] = [
    tool,
    { ...tool, callId: "other", input: { cmd: "git status" } },
  ].map((tool) => ({ role: "tool", text: "", timestamp: "now", tool }));
  const items = buildTranscript(messages);
  const content = (
    <Transcript
      items={items}
      task={demoSnapshot.tasks[4]}
      childTasks={[]}
      onOpen={vi.fn()}
    />
  );
  const view = render(content);
  expect(
    screen.queryByRole("button", { name: /执行过程/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("npm test")).toBeVisible();
  expect(screen.getByText("git status")).toBeVisible();
  expect(
    screen.queryByRole("region", { name: "命令执行详情" }),
  ).not.toBeInTheDocument();
  view.rerender(
    <ConversationSearchContext.Provider
      value={{
        id: "match",
        path: [items[0].key],
        text: "all checks passed",
        offset: 0,
        query: "all checks passed",
      }}
    >
      {content}
    </ConversationSearchContext.Provider>,
  );
  expect(screen.getByText(/all checks passed/)).toBeVisible();
  expect(
    view.container.querySelector('[data-tool-id="other"]'),
  ).not.toHaveAttribute("open");
});
