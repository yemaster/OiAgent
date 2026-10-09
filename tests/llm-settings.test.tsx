import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { LlmSettings, type LlmDraft } from "@/components/workspace/LlmSettings";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({ desktop: true, call: vi.fn() }));
const saved = {
  configured: true,
  baseUrl: "https://api.example/v1",
  model: "saved-model",
  hasKey: true,
};
function Fixture({ initial }: { initial?: LlmDraft }) {
  const [value, onChange] = useState(
    initial || { url: "", model: "", key: "" },
  );
  return <LlmSettings value={value} onChange={onChange} />;
}
beforeEach(() => {
  localStorage.clear();
  vi.mocked(call).mockReset();
  vi.mocked(call).mockImplementation(async (command) =>
    command === "llm_status" || command === "configure_llm" ? saved : undefined,
  );
});
it("restores metadata and uses an empty password field to retain the encrypted key", async () => {
  const user = userEvent.setup();
  render(<Fixture />);
  await waitFor(() =>
    expect(screen.getByLabelText("模型")).toHaveValue("saved-model"),
  );
  expect(screen.getByLabelText("API Key")).toHaveValue("");
  expect(screen.getByLabelText("API Key")).toHaveAttribute(
    "placeholder",
    "已加密保存，留空保留",
  );
  await user.click(screen.getByRole("button", { name: "保存配置" }));
  expect(call).toHaveBeenCalledWith("configure_llm", {
    config: { baseUrl: saved.baseUrl, model: saved.model, apiKey: "" },
  });
  expect(call).not.toHaveBeenCalledWith("test_llm");
});
it("does not overwrite unsaved API edits when returning to settings", async () => {
  render(
    <Fixture
      initial={{
        url: "https://draft.example/v1",
        model: "draft-model",
        key: "",
        edited: true,
      }}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "保存配置" })).toBeEnabled(),
  );
  expect(screen.getByLabelText("API Base URL")).toHaveValue(
    "https://draft.example/v1",
  );
  expect(screen.getByLabelText("模型")).toHaveValue("draft-model");
});
it("keeps entered secrets after failed secure storage and clears fields only after successful deletion", async () => {
  const user = userEvent.setup();
  render(<Fixture />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "保存配置" })).toBeEnabled(),
  );
  await user.type(screen.getByLabelText("API Key"), "test-secret");
  vi.mocked(call).mockImplementation(async (command) => {
    if (command === "configure_llm") throw new Error("凭据库锁定");
    return saved;
  });
  await user.click(screen.getByRole("button", { name: "保存配置" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("凭据库锁定");
  expect(screen.getByLabelText("API Key")).toHaveValue("test-secret");
  expect(JSON.stringify(localStorage)).not.toContain("test-secret");
  await user.click(screen.getByRole("button", { name: "移除配置" }));
  await user.click(screen.getByRole("button", { name: "移除", exact: true }));
  await waitFor(() => expect(screen.getByLabelText("API Key")).toHaveValue(""));
  expect(call).toHaveBeenCalledWith("clear_llm");
});
