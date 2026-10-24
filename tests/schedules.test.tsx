import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ScheduleEditorPage } from "@/pages/ScheduleEditor";
import { SchedulesPage } from "@/pages/Schedules";
import { call, pickDirectory } from "@/lib/api";
import {
  newSchedule,
  scheduleBusy,
  scheduleTime,
  validateSchedule,
  type Schedule,
} from "@/lib/schedules";
import { demoSnapshot } from "@/lib/demo";
import type { useSchedules } from "@/hooks/useSchedules";
vi.mock("@/lib/api", () => ({
  call: vi.fn(),
  desktop: true,
  pickDirectory: vi.fn(),
}));
const definition = () => ({
  ...newSchedule(demoSnapshot.agents, "/project"),
  name: "每日检查",
  target: {
    kind: "agent" as const,
    agentId: demoSnapshot.agents[0].id,
    prompt: "检查最近的修改\n列出结果",
    permission: "read-only",
    model: "",
    providerId: null,
  },
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(call).mockImplementation(async (command, args) => {
    if (command === "preview_schedule") return ["2026-11-01T01:00:00Z"];
    if (command === "save_schedule")
      return {
        definition: {
          ...(args!.definition as object),
          id: "schedule",
          revision: 1,
        },
        runs: [],
        nextRunAt: "2026-11-01T01:00:00Z",
      };
    throw new Error(`Unexpected ${command}`);
  });
});
it("saves the selected weekdays and project without accidentally starting a task", async () => {
  const saved = vi.fn().mockResolvedValue(undefined),
    back = vi.fn();
  vi.mocked(pickDirectory).mockResolvedValue("/other-project");
  function Editor() {
    const [def, setDef] = useState(definition());
    return (
      <TooltipProvider>
        <ScheduleEditorPage
          definition={def}
          snapshot={demoSnapshot}
          workflows={[]}
          onChange={setDef}
          onSaved={saved}
          onBack={back}
          onOpen={vi.fn()}
        />
      </TooltipProvider>
    );
  }
  const user = userEvent.setup();
  render(<Editor />);
  await user.click(screen.getByRole("button", { name: "选择定时任务项目" }));
  expect(screen.getByLabelText("项目目录")).toHaveValue("/other-project");
  expect(call).not.toHaveBeenCalledWith("save_schedule", expect.anything());
  await user.click(screen.getByRole("combobox", { name: "执行类型" }));
  await user.click(screen.getByRole("option", { name: "已保存的工作流" }));
  await user.click(screen.getByRole("combobox", { name: "执行类型" }));
  await user.click(screen.getByRole("option", { name: "Agent 任务" }));
  expect(screen.getByLabelText("任务内容")).toHaveValue(
    "检查最近的修改\n列出结果",
  );
  await user.click(screen.getByRole("combobox", { name: "执行频率" }));
  await user.click(screen.getByRole("option", { name: "每周", exact: true }));
  await user.click(screen.getByRole("button", { name: "周五" }));
  await user.click(screen.getByText("高级设置"));
  await user.click(screen.getByRole("combobox", { name: "错过执行时" }));
  await user.click(screen.getByRole("option", { name: "恢复后补跑一次" }));
  await user.click(screen.getByRole("button", { name: "保存", exact: true }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(call).toHaveBeenCalledWith("save_schedule", {
    definition: expect.objectContaining({
      project: "/other-project",
      catchUp: true,
      rule: expect.objectContaining({ kind: "weekly", weekdays: [0, 4] }),
      target: expect.objectContaining({ prompt: "检查最近的修改\n列出结果" }),
    }),
  });
  expect(call).not.toHaveBeenCalledWith("run_schedule", expect.anything());
  expect(back).toHaveBeenCalledOnce();
});
it("keeps invalid timezones editable without crashing and rejects an empty weekly schedule", async () => {
  function Editor() {
    const [def, setDef] = useState({
      ...definition(),
      rule: {
        kind: "weekly" as const,
        time: "09:00",
        timezone: "Asia/Shanghai",
        weekdays: [0],
      },
    });
    return (
      <TooltipProvider>
        <ScheduleEditorPage
          definition={def}
          snapshot={demoSnapshot}
          workflows={[]}
          onChange={(d) => setDef(d as typeof def)}
          onSaved={vi.fn()}
          onBack={vi.fn()}
          onOpen={vi.fn()}
        />
      </TooltipProvider>
    );
  }
  const user = userEvent.setup();
  render(<Editor />);
  await user.click(screen.getByRole("button", { name: "周一" }));
  await user.click(screen.getByRole("button", { name: "保存", exact: true }));
  expect(screen.getByRole("alert")).toHaveTextContent("请选择每周执行的日期");
  expect(() => scheduleTime("2026-11-01T01:00:00Z", "Asia/")).not.toThrow();
});
it("shows the next run and pauses without stopping the active task", async () => {
  const item: Schedule = {
    definition: { ...definition(), id: "schedule", revision: 2 },
    nextRunAt: "2026-11-01T01:00:00Z",
    runs: [
      {
        id: "run",
        taskId: "task",
        status: "waiting",
        trigger: "schedule",
        startedAt: "2026-10-25T01:00:00Z",
        scheduledAt: "2026-10-25T01:00:00Z",
        message: "",
      },
    ],
  };
  item.runs.unshift({
    ...item.runs[0],
    id: "skipped",
    taskId: null,
    status: "skipped",
    message: "上一轮尚未结束",
  });
  const refresh = vi.fn().mockResolvedValue(undefined);
  vi.mocked(call).mockResolvedValue(undefined);
  const state = {
    items: [item],
    loaded: true,
    error: "",
    refresh,
  } as unknown as ReturnType<typeof useSchedules>;
  const user = userEvent.setup();
  render(
    <TooltipProvider>
      <SchedulesPage
        state={state}
        onEdit={vi.fn()}
        onNew={vi.fn()}
        onOpen={vi.fn()}
      />
    </TooltipProvider>,
  );
  expect(screen.getByText(/下次：/)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "立即运行：每日检查" }),
  ).toBeDisabled();
  expect(screen.getByText("等待操作")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "暂停：每日检查" }));
  expect(call).toHaveBeenCalledExactlyOnceWith("set_schedule_enabled", {
    id: "schedule",
    revision: 2,
    enabled: false,
  });
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
});
it("validates timing and keeps stopping runs busy", () => {
  expect(
    validateSchedule({
      ...definition(),
      rule: { kind: "once", at: "2000-01-01T00:00:00Z" },
    }),
  ).toContain("未来");
  expect(
    validateSchedule({
      ...definition(),
      rule: { kind: "interval", minutes: 0 },
    }),
  ).toContain("间隔");
  expect(
    scheduleBusy({
      definition: definition(),
      nextRunAt: null,
      runs: [{ status: "stopping" } as Schedule["runs"][number]],
    }),
  ).toBe(true);
});
