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
  keyRef: "local-key",
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

it("only reads legacy credentials after an explicit migration click and keeps the draft", async () => {
  const user = userEvent.setup();
  const legacy = { ...saved, keyRef: undefined };
  let finish!: (value: unknown) => void;
  vi.mocked(call).mockImplementation(async (command) => {
    if (command === "migrate_provider_key")
      return new Promise((resolve) => {
        finish = resolve;
      });
    return saved;
  });
  render(<Form initial={providerDraft(legacy)} />);
  expect(call).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText("名称"));
  await user.type(screen.getByLabelText("名称"), "Unsaved name");
  await user.click(screen.getByRole("button", { name: "转存本地" }));
  expect(call).toHaveBeenCalledExactlyOnceWith("migrate_provider_key", {
    id: saved.id,
  });
  expect(screen.getByRole("button", { name: "转存本地" })).toBeDisabled();
  finish(saved);
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "转存本地" }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText("名称")).toHaveValue("Unsaved name");
  expect(screen.getByLabelText("API Key")).toHaveValue("");
  await user.click(screen.getByRole("button", { name: "保存配置" }));
  expect(call).toHaveBeenLastCalledWith("save_provider", {
    profile: expect.objectContaining({
      name: "Unsaved name",
      keyRef: saved.keyRef,
    }),
    apiKey: "",
  });
});
it("lets users replace a legacy key without accessing the system credential store", async () => {
  const user = userEvent.setup();
  render(<Form initial={providerDraft({ ...saved, keyRef: undefined })} />);
  await user.type(screen.getByLabelText("API Key"), "replacement");
  expect(
    screen.queryByRole("button", { name: "转存本地" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "保存配置" }));
  expect(call).toHaveBeenCalledExactlyOnceWith(
    "save_provider",
    expect.objectContaining({ apiKey: "replacement" }),
  );
});
it("does not migrate a legacy key to an edited service or test it from the list", async () => {
  const user = userEvent.setup();
  const onEdit = vi.fn();
  const legacy = { ...saved, keyRef: undefined };
  const view = render(
    <ProviderManager profiles={[legacy]} onChanged={vi.fn()} onEdit={onEdit} />,
  );
  await user.click(screen.getByRole("button", { name: "转存密钥" }));
  expect(onEdit).toHaveBeenCalledWith(legacy);
  expect(call).not.toHaveBeenCalled();
  view.unmount();
  render(<Form initial={providerDraft(legacy)} />);
  await user.clear(screen.getByLabelText("Base URL"));
  await user.type(
    screen.getByLabelText("Base URL"),
    "https://other.example.test",
  );
  expect(
    screen.queryByRole("button", { name: "转存本地" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "保存配置" })).toBeDisabled();
});

it("imports complete JSON into editable model mappings, 1M controls and advanced settings before saving", async () => {
  const { default: config } =
    await import("./fixtures/claude-provider-settings.json");
  const user = userEvent.setup();
  render(<Form />);
  await user.click(screen.getByRole("button", { name: "导入 JSON" }));
  const { fireEvent } = await import("@testing-library/react");
  fireEvent.change(screen.getByRole("textbox", { name: "JSON 配置" }), {
    target: { value: JSON.stringify(config) },
  });
  await user.click(screen.getByRole("button", { name: "应用配置" }));
  expect(call).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Sonnet")).toHaveValue("deepseek-flash");
  expect(screen.getByLabelText("Sonnet 显示名称")).toHaveValue(
    "deepseek-flash",
  );
  expect(
    screen.getByRole("checkbox", { name: "Sonnet 1M 上下文" }),
  ).toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "Haiku 1M 上下文" }),
  ).not.toBeChecked();
  expect(screen.getByLabelText("子代理模型")).toHaveValue("deepseek-flash");
  await user.click(screen.getByText("更多配置"));
  expect(screen.getByLabelText("启动模型（settings.model）")).toHaveValue(
    "claude-fable-5",
  );
  expect(
    screen.getByRole("switch", { name: "跳过 WebFetch 预检查" }),
  ).toBeChecked();
  expect(
    screen.getByRole("switch", {
      name: "rust-analyzer-lsp@claude-plugins-official",
    }),
  ).toBeChecked();
  await user.click(screen.getByRole("checkbox", { name: "Sonnet 1M 上下文" }));
  await user.click(screen.getByRole("button", { name: "保存配置" }));
  expect(call).toHaveBeenCalledWith(
    "save_provider",
    expect.objectContaining({
      apiKey: "fixture-token",
      profile: expect.objectContaining({
        sonnetModel: "deepseek-flash",
        opusModel: "deepseek-flash[1M]",
        settings: expect.objectContaining({
          model: "claude-fable-5",
          enabledPlugins: config.enabledPlugins,
          skipWebFetchPreflight: true,
          skipDangerousModePermissionPrompt: true,
        }),
      }),
    }),
  );
  const sent = vi
    .mocked(call)
    .mock.calls.find(([command]) => command === "save_provider")![1]!;
  expect(JSON.stringify(sent.profile)).not.toContain("fixture-token");
});

it("loads a JSON file into the import draft and keeps invalid input out of the form", async () => {
  const user = userEvent.setup();
  render(<Form initial={providerDraft(saved)} />);
  await user.click(screen.getByRole("button", { name: "导入 JSON" }));
  const file = new File(
    ['{"env": {"ANTHROPIC_MODEL": "uploaded-model"}, "model": "sonnet"}'],
    "settings.json",
    { type: "application/json" },
  );
  Object.defineProperty(file, "text", {
    value: async () =>
      '{"env": {"ANTHROPIC_MODEL": "uploaded-model"}, "model": "sonnet"}',
  });
  await user.upload(screen.getByLabelText("JSON 配置文件"), file);
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "JSON 配置" })).toHaveValue(
      '{"env": {"ANTHROPIC_MODEL": "uploaded-model"}, "model": "sonnet"}',
    ),
  );
  await user.click(screen.getByRole("button", { name: "应用配置" }));
  expect(screen.getByLabelText("默认模型")).toHaveValue("uploaded-model");
  await user.click(screen.getByRole("button", { name: "导入 JSON" }));
  await user.type(
    screen.getByRole("textbox", { name: "JSON 配置" }),
    "invalid-json",
  );
  await user.click(screen.getByRole("button", { name: "应用配置" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("JSON 格式错误");
  await user.click(screen.getByRole("button", { name: "取消", exact: true }));
  expect(screen.getByLabelText("默认模型")).toHaveValue("uploaded-model");
});
