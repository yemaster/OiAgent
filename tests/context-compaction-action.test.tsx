import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DetailPage } from "@/pages/Detail";
import { TooltipProvider } from "@/components/ui/tooltip";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({ call: vi.fn(), desktop: true }));

it.each(["codex", "claude"])(
  "%s compaction keeps the composer draft and targets the existing session",
  async (kind) => {
    const agent = demoSnapshot.agents.find((a) => a.kind === kind)!;
    const task = {
      ...demoSnapshot.tasks[0],
      id: `compact-${kind}`,
      source: "managed",
      status: "completed",
      agentId: agent.id,
      agentKind: kind,
      sessionId: "native-session",
      contextUsage: {
        input: 18000,
        output: 2000,
        cached: 12000,
        window: 200000,
      },
    };
    vi.mocked(call).mockClear();
    vi.mocked(call).mockImplementation(async (name) => {
      if (name === "get_detail") return { task, messages: [], log: "" };
      if (name === "task_artifacts") return { files: [], truncated: false };
      if (name === "task_commands")
        return {
          commands: [{ name: "compact", description: "Compress" }],
          models: [],
        };
      if (name === "compact_task" || name === "queue_message") return task;
      return [];
    });
    render(
      <TooltipProvider>
        <DetailPage
          task={task}
          tasks={[]}
          agents={demoSnapshot.agents}
          profiles={[]}
          onBack={vi.fn()}
          onRetry={vi.fn()}
          onOpen={vi.fn()}
          onChanged={vi.fn()}
        />
      </TooltipProvider>,
    );
    const user = userEvent.setup();
    const draft = screen.getByRole("textbox", { name: "继续对话" });
    await user.type(draft, "保留未发送草稿");
    await user.click(screen.getByRole("button", { name: "上下文用量" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "压缩上下文" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "压缩上下文" }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        kind === "codex" ? "compact_task" : "queue_message",
        kind === "codex"
          ? { id: task.id }
          : expect.objectContaining({
              id: task.id,
              text: "/compact",
              agentId: agent.id,
              attachments: [],
              immediate: false,
            }),
      ),
    );
    await user.keyboard("{Escape}");
    expect(draft).toHaveValue("保留未发送草稿");
  },
);
