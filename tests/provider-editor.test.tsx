import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ProviderEditor } from "@/pages/ProviderEditor";
import { ProviderManager } from "@/components/workspace/ProviderManager";
import {
  providerDraft,
  blankProvider,
  type ProviderDraft,
} from "@/lib/providers";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({ desktop: true, call: vi.fn() }));
const saved = {
  ...blankProvider,
  id: "saved",
  name: "Team",
  baseUrl: "https://api.example.test",
  hasKey: true,
  defaultModel: "fable",
  fableModel: "gateway-fable",
};
function Form({
  initial = providerDraft(),
  onSaved = vi.fn(),
}: {
  initial?: ProviderDraft;
  onSaved?: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <ProviderEditor
      draft={draft}
      onChange={setDraft}
      onBack={vi.fn()}
      onSaved={async () => {
        setDraft((current) => ({ ...current, apiKey: "" }));
        await onSaved();
      }}
    />
  );
}
beforeEach(() => {
  vi.mocked(call).mockReset();
  vi.mocked(call).mockImplementation(async (command) => {
    if (command === "fetch_provider_models")
      return {
        models: [
          { id: "gateway-fable", name: "Fable gateway" },
          { id: "other-model", name: "Other model" },
        ],
        truncated: false,
      };
    if (command === "test_provider_connection")
      return { model: "gateway-fable", latencyMs: 42 };
    if (command === "save_provider") return saved;
  });
});
it("fetches and selects models for Fable, tests the draft, and saves it without a dialog", async () => {
  const user = userEvent.setup(),
    onSaved = vi.fn();
  render(<Form onSaved={onSaved} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("名称"), "Team");
  await user.type(
    screen.getByLabelText("Base URL"),
    "https://api.example.test",
  );
  await user.type(screen.getByLabelText("API Key"), "test-only");
  await user.click(screen.getByRole("button", { name: "获取模型列表" }));
  await screen.findByText("已获取 2 个模型");
  await user.click(screen.getByRole("button", { name: "选择Fable" }));
  await user.type(screen.getByLabelText("搜索Fable"), "fable");
  await user.click(screen.getByRole("button", { name: /Fable gateway/ }));
  expect(screen.getByLabelText("Fable")).toHaveValue("gateway-fable");
  await user.type(screen.getByLabelText("默认模型"), "fable");
  await user.click(screen.getByRole("button", { name: "测试连接" }));
  await screen.findByText("连接成功 · gateway-fable · 42 ms");
  expect(call).toHaveBeenCalledWith(
    "test_provider_connection",
    expect.objectContaining({
      apiKey: "test-only",
      model: "fable",
      profile: expect.objectContaining({ fableModel: "gateway-fable" }),
    }),
  );
  await user.click(screen.getByRole("button", { name: "保存配置" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(screen.getByLabelText("API Key")).toHaveValue("");
});
it("uses saved credentials without exposing them and invalidates old results after changing the service", async () => {
  const user = userEvent.setup();
  render(<Form initial={providerDraft(saved)} />);
  await user.click(screen.getByRole("button", { name: "获取模型列表" }));
  await screen.findByText("已获取 2 个模型");
  expect(call).toHaveBeenCalledWith("fetch_provider_models", {
    profile: saved,
    apiKey: "",
  });
  await user.click(screen.getByRole("button", { name: "测试连接" }));
  await screen.findByText("连接成功 · gateway-fable · 42 ms");
  await user.clear(screen.getByLabelText("Base URL"));
  await user.type(
    screen.getByLabelText("Base URL"),
    "https://other.example.test",
  );
  expect(
    screen.queryByText("连接成功 · gateway-fable · 42 ms"),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "选择Fable" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "保存配置" })).toBeDisabled();
  await user.type(screen.getByLabelText("API Key"), "new-test-key");
  expect(screen.getByRole("button", { name: "保存配置" })).toBeEnabled();
});
it("keeps manually entered models when discovery fails", async () => {
  const user = userEvent.setup();
  vi.mocked(call).mockRejectedValue(new Error("HTTP 404：服务未提供此接口"));
  render(<Form initial={providerDraft(saved)} />);
  await user.click(screen.getByRole("button", { name: "获取模型列表" }));
  await screen.findByText(/HTTP 404/);
  expect(screen.getByLabelText("Fable")).toHaveValue("gateway-fable");
  await user.type(screen.getByLabelText("Sonnet"), "manual-model");
  expect(screen.getByLabelText("Sonnet")).toHaveValue("manual-model");
});
it("offers connection tests directly in the saved API list", async () => {
  const user = userEvent.setup();
  render(
    <ProviderManager profiles={[saved]} onChanged={vi.fn()} onEdit={vi.fn()} />,
  );
  await user.click(screen.getByRole("button", { name: "测试连接" }));
  await screen.findByText("连接成功 · gateway-fable · 42 ms");
  expect(call).toHaveBeenCalledWith("test_provider_connection", {
    profile: saved,
    apiKey: "",
    model: "fable",
  });
});
