import { expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stepChanges, conversationChanges } from "@/lib/stepChanges";
import { buildTranscript } from "@/lib/transcript";
import { StepChanges } from "@/components/workspace/StepChanges";
import type { ToolEvent } from "@/lib/types";
vi.mock("@/lib/monaco", () => ({}));
vi.mock("@monaco-editor/react", () => ({
  DiffEditor: ({
    original,
    modified,
  }: {
    original: string;
    modified: string;
  }) => (
    <div data-testid="step-diff">
      <pre>{original}</pre>
      <pre>{modified}</pre>
    </div>
  ),
}));
const tool = (input: unknown, patch: Partial<ToolEvent> = {}): ToolEvent => ({
  callId: "edit-1",
  name: "Edit",
  input,
  output: null,
  state: "completed",
  ...patch,
});
it("keeps consecutive edits to the same file separate, without consulting disk or Git", () => {
  const rows = conversationChanges(
    buildTranscript([
      {
        role: "tool",
        text: "",
        timestamp: "",
        tool: tool({
          file_path: "/repo/a.ts",
          old_string: "one",
          new_string: "two",
        }),
      },
      {
        role: "tool",
        text: "",
        timestamp: "",
        tool: tool(
          { file_path: "/repo/a.ts", old_string: "two", new_string: "three" },
          { callId: "edit-2" },
        ),
      },
    ]),
    "/repo",
  );
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({
    before: "one",
    after: "two",
    scope: "fragment",
  });
  expect(rows[1]).toMatchObject({
    before: "two",
    after: "three",
    scope: "fragment",
  });
  expect(rows[0].id).not.toBe(rows[1].id);
});
it("does not pretend an overwritten Write was a newly created file", () => {
  const [unknown] = stepChanges(
    tool({ file_path: "a.ts", content: "new" }, { name: "Write" }),
    "/repo",
  );
  expect(unknown).toMatchObject({
    after: "new",
    scope: "unavailable",
    operation: "edit",
  });
  expect(unknown.before).toBeUndefined();
  const [known] = stepChanges(
    tool(
      { file_path: "a.ts", content: "new" },
      { name: "Write", fileResult: { originalFile: "old", type: "update" } },
    ),
    "/repo",
  );
  expect(known).toMatchObject({ before: "old", after: "new", scope: "file" });
  expect(
    stepChanges(
      tool(
        { file_path: "a.ts", content: "" },
        { name: "Write", fileResult: { type: "create" } },
      ),
      "/repo",
    ),
  ).toMatchObject([{ operation: "add", before: "", after: "" }]);
});
it("reads Codex native add/delete/update/rename evidence", () => {
  const rows = stepChanges(
    tool(
      {
        changes: [
          { path: "new.ts", kind: "add", after: "created\n" },
          { path: "gone.ts", kind: "delete", before: "deleted\n" },
          {
            path: "old.ts",
            kind: "update",
            move_path: "renamed.ts",
            diff: "@@ -1 +1 @@\n-old\n+new",
          },
        ],
      },
      { name: "file_change" },
    ),
    "/repo",
  );
  expect(rows).toMatchObject([
    { operation: "add", before: "", after: "created\n", scope: "file" },
    { operation: "delete", before: "deleted\n", after: "", scope: "file" },
    {
      operation: "rename",
      originalPath: "old.ts",
      relativePath: "renamed.ts",
      scope: "patch",
    },
  ]);
});
it("keeps each patch's file and hunk boundaries; missing deleted content stays unknown", () => {
  const rows = stepChanges(
    tool(
      "*** Begin Patch\n*** Update File: a.ts\n@@\n-old\n+new\n*** Add File: b.ts\n+added\n*** Delete File: c.ts\n*** End Patch",
      { name: "apply_patch" },
    ),
    "/repo",
  );
  expect(rows[0].patch).toContain("-old\n+new");
  expect(rows[0].patch).not.toContain("b.ts");
  expect(rows[1]).toMatchObject({ before: "", after: "added" });
  expect(rows[2].before).toBeUndefined();
  expect(rows[2].scope).toBe("unavailable");
});
it("retains failed plans, empty replacements, multiple edits and structured Qoder/Claude patches", () => {
  const rows = stepChanges(
    tool(
      {
        file_path: "a.ts",
        edits: [
          { old_string: "remove", new_string: "" },
          { old_string: "same", new_string: "same" },
          { old_string: "before", new_string: "after" },
        ],
      },
      { name: "MultiEdit", state: "failed" },
    ),
    "/repo",
  );
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({
    before: "remove",
    after: "",
    state: "failed",
  });
  const [patch] = stepChanges(
    tool(
      { file_path: "a.ts", old_string: "one", new_string: "two" },
      {
        fileResult: {
          structuredPatch: [
            {
              oldStart: 5,
              oldLines: 1,
              newStart: 5,
              newLines: 1,
              lines: ["-one", "+two"],
            },
          ],
        },
      },
    ),
    "/repo",
  );
  expect(patch.patch).toBe("@@ -5,1 +5,1 @@\n-one\n+two");
  expect(patch.before).toBeUndefined();
});
it("does not derive changes from reads or invent complete text from truncated records", () => {
  expect(
    stepChanges(tool({ file_path: "a.ts" }, { name: "Read" }), "/repo"),
  ).toEqual([]);
  const [row] = stepChanges(
    tool({
      file_path: "a.ts",
      old_string: "old",
      new_string: "new\n[内容过长，已截断]",
    }),
    "/repo",
  );
  expect(row.scope).toBe("fragment");
  expect(row.note).toBe("记录已截断");
});
it("shows a file list, defaults to the latest edit and lets the user select an earlier step", async () => {
  const changes = [
    ...stepChanges(
      tool({ file_path: "a.ts", old_string: "one", new_string: "two" }),
      "/repo",
      "s1",
    ),
    ...stepChanges(
      tool({ file_path: "a.ts", old_string: "two", new_string: "three" }),
      "/repo",
      "s2",
    ),
  ];
  const user = userEvent.setup();
  render(<StepChanges changes={changes} project="/repo" />);
  expect(await screen.findByTestId("step-diff")).toHaveTextContent("three");
  expect(
    within(screen.getByRole("navigation", { name: "改动文件" })).getAllByRole(
      "button",
    ),
  ).toHaveLength(1);
  await user.click(screen.getByRole("combobox", { name: "选择修改步骤" }));
  await user.click(screen.getByRole("option", { name: "第 1 次 · 修改" }));
  expect(screen.getByTestId("step-diff")).toHaveTextContent("one");
  expect(screen.getByTestId("step-diff")).not.toHaveTextContent("three");
});
