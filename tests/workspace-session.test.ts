import { beforeEach, expect, it } from "vitest";
import {
  readWorkspaceSession,
  writeWorkspaceSession,
  type WorkspaceSession,
} from "@/lib/workspaceSession";
import {
  editorGroups,
  initialEditorLayout,
  moveEditorTab,
} from "@/lib/editorGroups";
import { fileId } from "@/lib/files";
beforeEach(() => localStorage.clear());
function session(): WorkspaceSession {
  const id = fileId("/project", "file.ts", "edit");
  const layout = moveEditorTab(
    initialEditorLayout(["page", "task:a", `file:${id}`], "task:a"),
    `file:${id}`,
    "group-0",
    "right",
  );
  return {
    version: 1,
    page: "integrations",
    project: "/project",
    opened: ["a"],
    selected: null,
    selectedFile: id,
    files: [{ id, project: "/project", path: "file.ts", mode: "edit" }],
    layout,
  };
}
it("round trips tab order, selected file and split layout without saving file contents", () => {
  const original = session();
  Object.assign(original.files[0], {
    content: "SECRET_DRAFT",
    saved: "SECRET_DISK",
    revision: "secret",
  });
  writeWorkspaceSession(original);
  const restored = readWorkspaceSession()!;
  expect(restored.selectedFile).toBe(original.selectedFile);
  expect(editorGroups(restored.layout.root).map((group) => group.tabs)).toEqual(
    editorGroups(original.layout.root).map((group) => group.tabs),
  );
  expect(JSON.stringify(restored)).not.toContain("SECRET");
});
it("normalizes unavailable draft pages and rejects corrupt data", () => {
  writeWorkspaceSession({ ...session(), page: "workflow-edit" });
  expect(readWorkspaceSession()?.page).toBe("supervisor");
  localStorage.setItem("oiagent-workspace-session-v1", "{broken");
  expect(readWorkspaceSession()).toBeNull();
});
it("filters duplicate and invalid tab references and bounds recursive layouts", () => {
  const original = session();
  original.layout = initialEditorLayout(
    ["page", "task:a", "task:a", "file:missing"],
    "missing",
  );
  writeWorkspaceSession(original);
  expect(editorGroups(readWorkspaceSession()!.layout.root)[0].tabs).toEqual([
    "page",
    "task:a",
  ]);
  expect(editorGroups(readWorkspaceSession()!.layout.root)[0].active).toBe(
    "page",
  );
});
