import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AiSourceSettings } from "@/components/workspace/AiSourceSettings";
import { call } from "@/lib/api";
import { demoSnapshot } from "@/lib/demo";
vi.mock("@/lib/api", () => ({ desktop: true, call: vi.fn() }));
it("restores an installed Agent source and saves the selected model before testing", async () => {
  const agent = demoSnapshot.agents.find((a) => a.available && a.kind === "codex")!;
  vi.mocked(call).mockImplementation(async (command) => command === "ai_source_settings" ? {
    source: { agentId: agent.id, model: "original", providerId: null }, agents: [agent], providers: [],
  } : undefined);
  render(<AiSourceSettings><p>API fields</p></AiSourceSettings>);
  const input = await screen.findByLabelText("模型");
  expect(input).toHaveValue("original");
  expect(screen.queryByText("API fields")).toBeNull();
  const user = userEvent.setup();
  await user.clear(input);
  await user.type(input,"selected-model");
  await user.click(screen.getByRole("button", { name: "测试连接" }));
  await waitFor(() => expect(call).toHaveBeenCalledWith("test_llm"));
  expect(call).toHaveBeenCalledWith("set_ai_source", { source: { agentId: agent.id, model: "selected-model", providerId: null } });
  const commands = vi.mocked(call).mock.calls.map(([command]) => command);
  expect(commands.indexOf("set_ai_source")).toBeLessThan(commands.indexOf("test_llm"));
});
