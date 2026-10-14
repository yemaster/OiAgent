import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ProjectPicker } from "@/components/workspace/ProjectPicker";

it("finds recent projects and accepts an absolute directory without losing the draft on dismiss", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(
    <ProjectPicker
      projects={["/work/alpha", "/work/beta"]}
      value="/work/alpha"
      temporary={false}
      remote={false}
      onSelect={onSelect}
    />,
  );
  await user.click(screen.getByRole("button", { name: "选择项目" }));
  await user.type(screen.getByRole("textbox", { name: "查找项目" }), "beta");
  await user.keyboard("{ArrowDown}{Enter}");
  expect(onSelect).toHaveBeenLastCalledWith("/work/beta", false);
  await user.click(screen.getByRole("button", { name: "选择项目" }));
  await user.type(
    screen.getByRole("textbox", { name: "查找项目" }),
    "/work/new project{Enter}",
  );
  expect(onSelect).toHaveBeenLastCalledWith("/work/new project", false);
  onSelect.mockClear();
  await user.click(screen.getByRole("button", { name: "选择项目" }));
  await user.type(
    screen.getByRole("textbox", { name: "查找项目" }),
    "/cancelled{Escape}",
  );
  expect(onSelect).not.toHaveBeenCalled();
});

it("only offers known directories for a remote device", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(
    <ProjectPicker
      projects={["/remote/repo"]}
      value=""
      temporary={false}
      remote
      onSelect={onSelect}
    />,
  );
  await user.click(screen.getByRole("button", { name: "选择项目" }));
  expect(
    screen.queryByRole("option", { name: "临时项目" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "打开文件夹…" }),
  ).not.toBeInTheDocument();
  await user.type(
    screen.getByRole("textbox", { name: "查找项目" }),
    "/local/new{Enter}",
  );
  expect(onSelect).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("option", { name: /使用此路径/ }),
  ).not.toBeInTheDocument();
});
