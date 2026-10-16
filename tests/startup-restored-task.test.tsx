import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import App from "@/App";
import { demoSnapshot } from "@/lib/demo";
import { writeWorkspaceSession } from "@/lib/workspaceSession";
import { initialEditorLayout } from "@/lib/editorGroups";

it("restores open conversations on cold startup in StrictMode", async () => {
  const tasks = demoSnapshot.tasks.slice(0, 2);
  writeWorkspaceSession({
    version: 1,
    page: "tasks",
    project: tasks[1].project,
    opened: tasks.map((t) => t.id),
    selected: tasks[1].id,
    selectedFile: null,
    files: [],
    layout: initialEditorLayout(
      ["page", ...tasks.map((t) => `task:${t.id}`)],
      `task:${tasks[1].id}`,
    ),
  });
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  expect(
    await screen.findByRole("textbox", { name: "继续对话" }),
  ).toBeVisible();
});
