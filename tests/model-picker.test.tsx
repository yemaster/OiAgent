import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ModelPicker } from "@/components/workspace/ModelPicker";
import { NewTaskPage } from "@/pages/NewTask";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
import {
  applyModelOptions,
  readModelOptions,
  emptyModelOptions,
} from "@/lib/modelOptions";
import { newTaskDraft } from "@/lib/newTask";
vi.mock("@/lib/api", () => ({
  desktop: true,
  call: vi.fn(),
  pickDirectory: vi.fn(),
}));
const catalog = {
  models: [
    {
      value: "model-a",
      label: "Model A",
      efforts: ["low", "high"],
      defaultEffort: "low",
      contextWindows: [400000, 200000],
      serviceTiers: [{ value: "priority", label: "Fast" }],
    },
    { value: "model-b", label: "Model B", efforts: [], serviceTiers: [] },
  ],
  defaultModel: "model-a",
  defaultEffort: "high",
  defaultServiceTier: "",
};
beforeEach(() => {
  vi.mocked(call)
    .mockReset()
    .mockImplementation(async (cmd) =>
      cmd === "agent_models" ? catalog : demoSnapshot.tasks[0],
    );
});
it("uses native capabilities and drops incompatible tuning when changing models", async () => {
  const user = userEvent.setup();
  const changed = vi.fn();
  function Harness() {
    const [model, setModel] = useState("");
    const [options, setOptions] = useState(emptyModelOptions);
    return (
      <ModelPicker
        agent={{
          ...demoSnapshot.agents[0],
          id: "picker-models",
          kind: "codex",
        }}
        project="/project"
        model={model}
        onModel={setModel}
        options={options}
        onOptions={(value) => {
          changed(value);
          setOptions(value);
        }}
        provider="local"
        onProvider={vi.fn()}
      />
    );
  }
  render(<Harness />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "选择模型" })).toHaveTextContent(
      "Model A",
    ),
  );
  await user.click(screen.getByRole("button", { name: "选择模型" }));
  screen.getByRole("slider", { name: "思考深度" }).focus();
  await user.keyboard("{Home}{End}");
  await user.click(screen.getByRole("combobox", { name: "模型速度" }));
  await user.click(screen.getByRole("option", { name: "Fast" }));
  expect(changed).toHaveBeenLastCalledWith({
    effort: "high",
    serviceTier: "priority",
  });
  const context = screen.getByRole("slider", { name: "上下文窗口" });
  context.focus();
  await user.keyboard("{Home}{ArrowRight}");
  expect(context).toHaveAttribute("aria-valuetext", "200K");
  expect(context).toHaveAttribute("aria-valuemax", "2");
  await user.keyboard("{ArrowRight}");
  expect(context).toHaveAttribute("aria-valuetext", "400K");
  expect(changed).toHaveBeenLastCalledWith({
    effort: "high",
    serviceTier: "priority",
    contextWindow: 400000,
  });
  await user.click(screen.getByRole("button", { name: "恢复默认上下文窗口" }));
  expect(context).toHaveAttribute("aria-valuetext", "默认");
  expect(changed.mock.lastCall?.[0].contextWindow).toBeUndefined();
  await user.click(screen.getByRole("button", { name: "恢复默认思考深度" }));
  expect(screen.getByRole("slider", { name: "思考深度" })).toHaveAttribute(
    "aria-valuetext",
    "高（默认）",
  );
  await user.click(
    screen.getByRole("button", { name: "Model B", exact: true }),
  );
  await waitFor(() =>
    expect(changed).toHaveBeenLastCalledWith({
      effort: "",
      serviceTier: "default",
    }),
  );
  expect(
    screen.queryByRole("slider", { name: "思考深度" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "模型速度" }),
  ).not.toBeInTheDocument();
});
it("places Claude API profiles beside the composer and submits the chosen profile", async () => {
  const user = userEvent.setup();
  const agent = {
    ...demoSnapshot.agents[0],
    id: "claude-profile-test",
    kind: "claude",
    name: "Claude Code",
  };
  const snapshot = {
    ...demoSnapshot,
    agents: [agent],
    providers: [
      {
        id: "api-b",
        name: "团队 API",
        baseUrl: "https://example.com",
        authType: "api-key",
        defaultModel: "",
        haikuModel: "",
        sonnetModel: "",
        opusModel: "",
        fableModel: "",
        hasKey: true,
      },
    ],
  };
  render(
    <NewTaskPage
      snapshot={snapshot}
      project="/project"
      draft={{ ...newTaskDraft(snapshot, "/project"), agent: agent.id }}
      onCreated={vi.fn()}
      onSettings={vi.fn()}
      onAgents={vi.fn()}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "选择模型" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("group", { name: "任务工具与发送" }),
  ).toContainElement(screen.getByRole("button", { name: "API 配置" }));
  await user.click(screen.getByRole("button", { name: "API 配置" }));
  await user.click(screen.getByRole("button", { name: "团队 API" }));
  expect(screen.getByRole("button", { name: "API 配置" })).toHaveTextContent(
    "团队 API",
  );
  fireEvent.change(screen.getByRole("textbox", { name: "任务内容" }), {
    target: { value: "检查项目" },
  });
  await user.click(screen.getByRole("button", { name: "启动任务" }));
  expect(call).toHaveBeenCalledWith("create_task", {
    input: expect.objectContaining({ providerId: "api-b", model: "" }),
  });
  expect(
    vi.mocked(call).mock.calls.some(([cmd]) => cmd === "agent_models"),
  ).toBe(false);
  expect(
    screen.getByRole("button", { name: "任务模板" }),
  ).not.toHaveTextContent("任务模板");
});
it("submits model tuning as native launch arguments from the new-task composer", async () => {
  const user = userEvent.setup();
  const agent = {
    ...demoSnapshot.agents[0],
    id: "launch-model-options",
    kind: "codex",
  };
  const snapshot = { ...demoSnapshot, agents: [agent] };
  render(
    <NewTaskPage
      snapshot={snapshot}
      project="/project"
      draft={{
        ...newTaskDraft(snapshot, "/project"),
        agent: agent.id,
        prompt: "检查代码",
        argsText: "-c\nfoo=1",
      }}
      onCreated={vi.fn()}
      onSettings={vi.fn()}
      onAgents={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: "选择模型" }));
  await user.click(
    await screen.findByRole("button", { name: "Model A", exact: true }),
  );
  screen.getByRole("slider", { name: "思考深度" }).focus();
  await user.keyboard("{Home}{End}");
  await user.click(screen.getByRole("combobox", { name: "模型速度" }));
  await user.click(screen.getByRole("option", { name: "Fast" }));
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "启动任务" }));
  expect(call).toHaveBeenCalledWith("create_task", {
    input: expect.objectContaining({
      model: "model-a",
      extraArgs: [
        "-c",
        "foo=1",
        "-c",
        'model_reasoning_effort="high"',
        "-c",
        'service_tier="priority"',
      ],
    }),
  });
});
it("round trips launch tuning without dropping unrelated advanced settings", () => {
  const args = [
    "-c",
    'model_reasoning_effort="low"',
    '--config=service_tier="fast"',
    "-c",
    "foo=1",
  ];
  expect(readModelOptions("codex", args)).toEqual({
    effort: "low",
    serviceTier: "fast",
  });
  const next = applyModelOptions("codex", args, {
    effort: "high",
    serviceTier: "priority",
  });
  expect(next).toEqual([
    "-c",
    "foo=1",
    "-c",
    'model_reasoning_effort="high"',
    "-c",
    'service_tier="priority"',
  ]);
  expect(applyModelOptions("codex", next, emptyModelOptions)).toEqual([
    "-c",
    "foo=1",
  ]);
  const qoder = applyModelOptions(
    "qodercn",
    ["--attachment", "file.png", "--reasoning-effort=max"],
    { effort: "low", serviceTier: "", contextWindow: 400000 },
  );
  expect(qoder).toEqual([
    "--attachment",
    "file.png",
    "--reasoning-effort",
    "low",
    "--context-window",
    "400000",
  ]);
  expect(readModelOptions("qodercn", qoder)).toEqual({
    effort: "low",
    serviceTier: "",
    contextWindow: 400000,
  });
});
