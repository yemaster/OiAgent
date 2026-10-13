import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { conversationLink } from "@/lib/conversationLinks";
import { buildTranscript } from "@/lib/transcript";
import { Transcript } from "@/components/workspace/Transcript";
import { demoSnapshot } from "@/lib/demo";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({
  desktop: true,
  call: vi.fn().mockResolvedValue(undefined),
}));

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
    expect(call).toHaveBeenCalledWith("open_conversation_link", {
      url: "https://example.com/docs",
    });
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
