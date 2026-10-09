import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { editedFiles, projectRelativePath } from "@/lib/editFiles";
import { Transcript } from "@/components/workspace/Transcript";
import { buildTranscript } from "@/lib/transcript";
import { demoSnapshot } from "@/lib/demo";

describe("file edit records", () => {
  it("normalizes only paths contained by the project", () => {
    expect(projectRelativePath("/repo", "/repo/src/a.ts")).toBe("src/a.ts");
    expect(projectRelativePath("/repo", "./src/a.ts")).toBe("src/a.ts");
    for (const path of [
      "/repo-other/a.ts",
      "../outside",
      "src/../../secret",
      ".git/config",
      "~/secret",
      "file:///secret",
    ])
      expect(projectRelativePath("/repo", path)).toBeUndefined();
  });
  it("extracts multiple patch files, renames and Codex file changes", () => {
    const files = editedFiles(
      {
        name: "apply_patch",
        state: "completed",
        input:
          "*** Begin Patch\n*** Update File: src/old.ts\n*** Move to: src/new.ts\n@@\n-old\n+new\n*** Add File: src/add.ts\n+x\n*** Delete File: src/gone.ts\n*** End Patch",
        output: null,
      },
      "/repo",
    );
    expect(
      files.map(({ relativePath, operation, originalPath }) => ({
        relativePath,
        operation,
        originalPath,
      })),
    ).toEqual([
      {
        relativePath: "src/new.ts",
        operation: "rename",
        originalPath: "src/old.ts",
      },
      { relativePath: "src/add.ts", operation: "add", originalPath: undefined },
      {
        relativePath: "src/gone.ts",
        operation: "delete",
        originalPath: undefined,
      },
    ]);
    expect(
      editedFiles(
        {
          name: "file_change",
          state: "completed",
          input: {
            changes: [
              { path: "/repo/a.ts", kind: "update" },
              { path: "/repo/b.ts", kind: "delete" },
            ],
          },
          output: null,
        },
        "/repo",
      ),
    ).toMatchObject([
      { relativePath: "a.ts", operation: "edit" },
      { relativePath: "b.ts", operation: "delete" },
    ]);
  });
  it("opens editor and workspace diff without expanding raw tool input", async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    const { container } = render(
      <Transcript
        items={buildTranscript([
          {
            role: "tool",
            text: "",
            timestamp: "now",
            tool: {
              name: "Edit",
              callId: "edit",
              state: "completed",
              input: {
                file_path: "/repo/src/a.ts",
                old_string: "old",
                new_string: "new",
              },
              output: null,
            },
          },
        ])}
        task={{ ...demoSnapshot.tasks[0], project: "/repo" }}
        childTasks={[]}
        onOpen={vi.fn()}
        onOpenFile={onOpenFile}
      />,
    );
    expect(screen.getByLabelText("文件编辑记录")).toBeVisible();
    expect(
      container.querySelector("details[data-tool-id=edit]"),
    ).not.toHaveAttribute("open");
    await user.click(screen.getByRole("button", { name: "打开文件 src/a.ts" }));
    expect(onOpenFile).toHaveBeenLastCalledWith("/repo", "src/a.ts", "edit");
    await user.click(screen.getByRole("button", { name: "查看改动 src/a.ts" }));
    expect(onOpenFile).toHaveBeenLastCalledWith(
      "/repo",
      "src/a.ts",
      "diff",
      undefined,
    );
  });
});
