import { useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { FileEditor } from "@/pages/FileEditor";
import type { OpenFile } from "@/lib/files";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({ desktop: true, call: vi.fn() }));
vi.mock("@/lib/monaco", () => ({}));
vi.mock("@/lib/appearance", () => ({
  useAppearance: () => ({ editorTheme: "follow" }),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));
vi.mock("@monaco-editor/react", () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label="文件正文"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
  DiffEditor: ({
    original,
    modified,
  }: {
    original: string;
    modified: string;
  }) => (
    <div aria-label="生成差异">
      <pre>{original}</pre>
      <pre>{modified}</pre>
    </div>
  ),
}));
const initial =
  "---\nname: review\ndescription: Review\n---\nOld instructions.";
const generated =
  "---\nname: review\ndescription: Review changes\n---\nNew instructions.";
const onSave = vi.fn(),
  onSettings = vi.fn();
function Harness() {
  const [file, setFile] = useState<OpenFile>({
    id: "skill",
    project: "/work",
    path: "review/SKILL.md",
    mode: "edit",
    content: initial,
    saved: initial,
    revision: "r",
    loading: false,
    saving: false,
    skill: {
      id: "review",
      name: "review",
      scope: { kind: "claude", project: null },
    },
  });
  return (
    <FileEditor
      file={file}
      onChange={(content) => setFile((f) => ({ ...f, content }))}
      onSave={onSave}
      onReload={vi.fn()}
      onResolve={vi.fn()}
      onOpen={vi.fn()}
      onLlmSettings={onSettings}
      onSkillWriting={(patch) =>
        setFile((f) => ({
          ...f,
          skillWriting: { ...f.skillWriting, ...patch },
        }))
      }
    />
  );
}
beforeEach(() => {
  onSave.mockClear();
  onSettings.mockClear();
  vi.mocked(call)
    .mockReset()
    .mockImplementation(async (command) => {
      if (command === "llm_status")
        return { configured: true, model: "test-model" };
      if (command === "write_skill")
        return {
          content: generated,
          usage: { input: 5, output: 8, cached: 0, known: true },
          reference: null,
        };
    });
});
it("previews generated content and applies it only to the unsaved editor", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "AI 帮写" }));
  await user.type(await screen.findByLabelText("编写要求"), "补充代码审查步骤");
  await user.click(screen.getByText("参考 Skill（可选）"));
  await user.click(screen.getByRole("combobox", { name: "参考 Skill" }));
  await user.click(
    screen.getByRole("option", { name: "网页测试 · Anthropic" }),
  );
  await user.click(screen.getByRole("button", { name: "生成 Skill" }));
  await screen.findByLabelText("生成差异");
  expect(call).toHaveBeenCalledWith("write_skill", {
    input: expect.objectContaining({
      name: "review",
      currentContent: initial,
      instruction: "补充代码审查步骤",
      referenceUrl: expect.stringContaining("anthropics/skills"),
    }),
  });
  expect(onSave).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "应用到编辑器" }));
  expect(screen.getByLabelText("文件正文")).toHaveValue(generated);
  expect(screen.getByText("未保存")).toBeVisible();
  expect(onSave).not.toHaveBeenCalled();
});
it("does not overwrite text edited while generation was in flight", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(call).mockImplementation(async (command) =>
    command === "llm_status"
      ? { configured: true, model: "test" }
      : new Promise((r) => {
          resolve = r;
        }),
  );
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "AI 帮写" }));
  await user.type(await screen.findByLabelText("编写要求"), "改进步骤");
  await user.click(screen.getByRole("button", { name: "生成 Skill" }));
  await user.type(screen.getByLabelText("文件正文"), " User changes.");
  await act(async () =>
    resolve({ content: generated, usage: {}, reference: null }),
  );
  expect(screen.getByRole("button", { name: "应用到编辑器" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("原文已修改");
  await user.click(screen.getByRole("button", { name: "放弃" }));
  expect(screen.getByLabelText("文件正文")).toHaveValue(
    initial + " User changes.",
  );
});
it("offers API settings without sending a request before configuration", async () => {
  vi.mocked(call).mockResolvedValue({ configured: false, model: "" });
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "AI 帮写" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "配置 LLM API" }),
  );
  expect(onSettings).toHaveBeenCalledOnce();
  await waitFor(() =>
    expect(call).not.toHaveBeenCalledWith("write_skill", expect.anything()),
  );
});
