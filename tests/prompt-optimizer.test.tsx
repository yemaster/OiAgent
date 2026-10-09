import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PromptOptimizer } from "@/components/workspace/PromptOptimizer";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({ desktop: true, call: vi.fn() }));
const mocked = vi.mocked(call);
beforeEach(() => {
  mocked.mockReset();
});
it("requires configured API without sending the prompt", async () => {
  mocked.mockResolvedValue({ configured: false });
  const user = userEvent.setup();
  const settings = vi.fn();
  const change = vi.fn();
  render(
    <PromptOptimizer prompt="原文" onChange={change} onSettings={settings} />,
  );
  await user.click(
    screen.getByRole("button", { name: "优化 Prompt", exact: true }),
  );
  await user.click(
    await screen.findByRole("button", { name: "配置 LLM API", exact: true }),
  );
  expect(settings).toHaveBeenCalledOnce();
  expect(change).not.toHaveBeenCalled();
  expect(mocked).toHaveBeenCalledTimes(1);
});
it("previews the result and prevents replacing text edited while the request was running", async () => {
  let resolve!: (value: unknown) => void;
  mocked.mockImplementation(async (command) =>
    command === "llm_status"
      ? { configured: true, model: "test" }
      : new Promise((done) => {
          resolve = done;
        }),
  );
  const user = userEvent.setup();
  const change = vi.fn();
  const settings = vi.fn();
  const view = render(
    <PromptOptimizer prompt="原文" onChange={change} onSettings={settings} />,
  );
  await user.click(
    screen.getByRole("button", { name: "优化 Prompt", exact: true }),
  );
  await user.click(await screen.findByRole("button", { name: "开始优化" }));
  view.rerender(
    <PromptOptimizer
      prompt="用户新输入"
      onChange={change}
      onSettings={settings}
    />,
  );
  resolve({
    prompt: "优化后的文本",
    usage: { input: 1, output: 2, cached: 0, known: true },
  });
  expect(
    await screen.findByRole("button", { name: "使用此版本" }),
  ).toBeDisabled();
  expect(change).not.toHaveBeenCalled();
  expect(mocked).toHaveBeenCalledWith("optimize_prompt", {
    prompt: "原文",
    style: "clarity",
  });
  view.rerender(
    <PromptOptimizer prompt="原文" onChange={change} onSettings={settings} />,
  );
  await user.click(screen.getByRole("button", { name: "使用此版本" }));
  expect(change).toHaveBeenCalledWith("优化后的文本");
  view.rerender(
    <PromptOptimizer
      prompt="优化后的文本"
      onChange={change}
      onSettings={settings}
    />,
  );
  await user.click(screen.getByRole("button", { name: "撤销 Prompt 优化" }));
  expect(change).toHaveBeenLastCalledWith("原文");
});
