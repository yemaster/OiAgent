import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { FileContextMenu } from "@/components/workspace/FileContextMenu";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({
  desktop: true,
  call: vi.fn().mockResolvedValue(undefined),
}));
it("reveals a file with its exact project and path, including spaces and shell characters", async () => {
  const user = userEvent.setup();
  render(
    <FileContextMenu
      project="/project with spaces"
      path="src/a $(name).ts"
      onOpen={vi.fn()}
    >
      <button>file</button>
    </FileContextMenu>,
  );
  fireEvent.contextMenu(screen.getByRole("button"));
  await user.click(
    screen.getByRole("menuitem", { name: "在系统文件管理器中显示" }),
  );
  expect(call).toHaveBeenCalledWith("system_file_action", {
    project: "/project with spaces",
    path: "src/a $(name).ts",
    action: "reveal",
  });
});
it("allows opening a local folder while keeping unavailable file actions disabled", async () => {
  const user = userEvent.setup();
  const view = render(
    <FileContextMenu project="/project" path="docs" directory>
      <button>folder</button>
    </FileContextMenu>,
  );
  fireEvent.contextMenu(screen.getByRole("button"));
  await user.click(screen.getByRole("menuitem", { name: "使用默认程序打开" }));
  expect(call).toHaveBeenCalledWith("system_file_action", {
    project: "/project",
    path: "docs",
    action: "open",
  });
  view.unmount();
  render(
    <FileContextMenu project="/remote" path="missing.md" deleted>
      <button>file</button>
    </FileContextMenu>,
  );
  fireEvent.contextMenu(screen.getByRole("button"));
  expect(
    screen.getByRole("menuitem", { name: "使用默认程序打开" }),
  ).toHaveAttribute("data-disabled");
});
