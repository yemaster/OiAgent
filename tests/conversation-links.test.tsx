import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { conversationLink } from "@/lib/conversationLinks";
import { buildTranscript } from "@/lib/transcript";
import { Transcript } from "@/components/workspace/Transcript";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
import { ExternalLinkSettings } from "@/components/workspace/ExternalLinkSettings";
import { confirmExternalLinks } from "@/lib/linkPreferences";
vi.mock("@/lib/api", () => ({
  desktop: true,
  call: vi.fn().mockResolvedValue(undefined),
}));
beforeEach(() => {
  localStorage.clear();
  vi.mocked(call).mockReset().mockResolvedValue(undefined);
});

describe("conversation file links", () => {
  it.each([
    ["src/main.ts:12:3", "src/main.ts", { line: 12, column: 3 }],
    ["/project/src/main.ts#L12-L15", "src/main.ts", { line: 12, column: 1 }],
    ["file:///project/a%20b.ts#L8", "a b.ts", { line: 8, column: 1 }],
    ["./README.md", "README.md", undefined],
  ])("resolves %s inside the project", (value, path, location) => {
    expect(conversationLink(value, "/project")).toEqual({
      kind: "file",
      path,
      location,
    });
  });
  it("accepts Windows file references", () => {
    expect(
      conversationLink("C:\\work\\app\\a.ts:4", "C:\\work\\app"),
    ).toMatchObject({ kind: "file", path: "a.ts", location: { line: 4 } });
    expect(
      conversationLink("file:///C:/work/app/a.ts#L4", "C:/work/app"),
    ).toMatchObject({ kind: "file", path: "a.ts" });
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,hello",
    "command:run",
    "../secret",
    "%2e%2e/secret",
    "/project-other/a.ts",
    "file://server/share/a",
    "//server/share/a",
    "https://user:secret@example.com",
    "src/a.ts:0",
    "src/a.ts%00",
  ])("rejects unsupported or out-of-project target %s", (value) => {
    expect(conversationLink(value, "/project")).toBeUndefined();
  });
  it("opens Markdown and inline file references, leaves code blocks alone and opens web links externally", async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    render(
      <Transcript
        task={{ ...demoSnapshot.tasks[0], project: "/project" }}
        childTasks={[]}
        onOpen={vi.fn()}
        onOpenFile={onOpenFile}
        items={buildTranscript([
          {
            role: "assistant",
            timestamp: "now",
            text: "[源码](/project/src/main.ts:12:3) 和 `src/other.ts#L7`、`/project/my file.ts`、`console.log`。[文档](https://example.com/docs)\n\n```\nsrc/not-a-link.ts\n```\n\n[危险](javascript:alert%281%29)",
          },
        ])}
      />,
    );
    await user.click(screen.getByRole("link", { name: "源码" }));
    expect(onOpenFile).toHaveBeenLastCalledWith(
      "/project",
      "src/main.ts",
      "edit",
      undefined,
      { line: 12, column: 3 },
    );
    await user.click(screen.getByRole("link", { name: "src/other.ts#L7" }));
    expect(onOpenFile).toHaveBeenLastCalledWith(
      "/project",
      "src/other.ts",
      "edit",
      undefined,
      { line: 7, column: 1 },
    );
    await user.click(screen.getByRole("link", { name: "/project/my file.ts" }));
    expect(onOpenFile).toHaveBeenLastCalledWith(
      "/project",
      "my file.ts",
      "edit",
      undefined,
      undefined,
    );
    expect(
      screen.queryByRole("link", { name: "console.log" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "src/not-a-link.ts" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "危险" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "文档" }));
    expect(call).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "前往 example.com？" }),
    ).toHaveTextContent("https://example.com/docs");
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(call).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "文档" })).toHaveFocus(),
    );
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "打开" }));
    expect(call).toHaveBeenCalledWith("open_conversation_link", {
      url: "https://example.com/docs",
    });
  });
  it("requires confirmation for modified clicks and middle clicks too", async () => {
    const user = userEvent.setup();
    render(
      <Transcript
        task={demoSnapshot.tasks[0]}
        childTasks={[]}
        onOpen={vi.fn()}
        items={buildTranscript([
          {
            role: "assistant",
            timestamp: "now",
            text: "[外链](https://example.com/)",
          },
        ])}
      />,
    );
    for (const event of [{ ctrlKey: true }, { metaKey: true }]) {
      expect(
        fireEvent.click(screen.getByRole("link", { name: "外链" }), event),
      ).toBe(false);
      expect(
        screen.getByRole("dialog", { name: "前往 example.com？" }),
      ).toBeVisible();
      expect(call).not.toHaveBeenCalled();
      await user.keyboard("{Escape}");
    }
    fireEvent(
      screen.getByRole("link", { name: "外链" }),
      new MouseEvent("auxclick", {
        bubbles: true,
        cancelable: true,
        button: 1,
      }),
    );
    expect(
      screen.getByRole("dialog", { name: "前往 example.com？" }),
    ).toBeVisible();
    expect(call).not.toHaveBeenCalled();
  });
  it("does not route remote file references to this computer", () => {
    render(
      <Transcript
        task={{
          ...demoSnapshot.tasks[0],
          project: "/project",
          deviceId: "peer",
        }}
        childTasks={[]}
        onOpen={vi.fn()}
        items={buildTranscript([
          {
            role: "assistant",
            timestamp: "now",
            text: "[源码](/project/a.ts)",
          },
        ])}
      />,
    );
    expect(
      screen.queryByRole("link", { name: "源码" }),
    ).not.toBeInTheDocument();
  });
});

describe("external link preferences", () => {
  function conversation() {
    return (
      <Transcript
        task={demoSnapshot.tasks[0]}
        childTasks={[]}
        onOpen={vi.fn()}
        items={buildTranscript([
          {
            role: "assistant",
            timestamp: "now",
            text: "[文档](https://example.com/docs) [其他](https://example.org/)",
          },
        ])}
      />
    );
  }

  it("does not remember the choice when the dialog is cancelled", async () => {
    const user = userEvent.setup();
    render(conversation());
    await user.click(screen.getByRole("link", { name: "文档" }));
    await user.click(screen.getByRole("switch", { name: "下次不再提示" }));
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(confirmExternalLinks()).toBe(true);
    expect(call).not.toHaveBeenCalled();
    await user.click(screen.getByRole("link", { name: "文档" }));
    expect(
      screen.getByRole("switch", { name: "下次不再提示" }),
    ).not.toBeChecked();
  });

  it("remembers successful confirmation across remounts and allows settings to restore it", async () => {
    const user = userEvent.setup();
    const first = render(
      <>
        <ExternalLinkSettings />
        {conversation()}
      </>,
    );
    await user.click(screen.getByRole("link", { name: "文档" }));
    await user.click(screen.getByRole("switch", { name: "下次不再提示" }));
    await user.click(screen.getByRole("button", { name: "打开" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(confirmExternalLinks()).toBe(false);
    expect(
      screen.getByRole("switch", { name: "打开外部链接前确认" }),
    ).not.toBeChecked();
    first.unmount();
    render(
      <>
        <ExternalLinkSettings />
        {conversation()}
      </>,
    );
    await user.click(screen.getByRole("link", { name: "其他" }));
    expect(call).toHaveBeenLastCalledWith("open_conversation_link", {
      url: "https://example.org/",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("switch", { name: "打开外部链接前确认" }),
    );
    expect(confirmExternalLinks()).toBe(true);
    vi.mocked(call).mockClear();
    await user.click(screen.getByRole("link", { name: "文档" }));
    expect(
      screen.getByRole("dialog", { name: "前往 example.com？" }),
    ).toBeVisible();
    expect(call).not.toHaveBeenCalled();
  });

  it("keeps confirmation enabled if opening the browser fails", async () => {
    const user = userEvent.setup();
    vi.mocked(call).mockRejectedValueOnce(new Error("Browser unavailable"));
    render(conversation());
    await user.click(screen.getByRole("link", { name: "文档" }));
    await user.click(screen.getByRole("switch", { name: "下次不再提示" }));
    await user.click(screen.getByRole("button", { name: "打开" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "打开" })).toBeEnabled(),
    );
    expect(confirmExternalLinks()).toBe(true);
    expect(screen.getByRole("dialog")).toBeVisible();
  });
});
