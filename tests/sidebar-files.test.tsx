import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ProjectFiles } from "@/components/workspace/ProjectFiles";
import { call } from "@/lib/api";
vi.mock("@/lib/api", () => ({ desktop: true, call: vi.fn() }));

it("loads each section on demand and stops polling while it is collapsed", async () => {
  vi.useFakeTimers();
  vi.mocked(call).mockImplementation(async (command) =>
    command === "project_changes"
      ? { git: true, files: [], truncated: false }
      : { entries: [], truncated: false },
  );
  const view = render(
    <ProjectFiles project="/repo" version={0} onOpen={vi.fn()} />,
  );
  try {
    await act(async () => {});
    expect(call).toHaveBeenCalledWith(
      "project_files",
      expect.objectContaining({ project: "/repo" }),
    );
    expect(call).not.toHaveBeenCalledWith("project_changes", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "文件", exact: true }));
    vi.mocked(call).mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000);
    });
    expect(call).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Git 改动", exact: true }));
    await act(async () => {});
    expect(call).toHaveBeenCalledWith(
      "project_changes",
      expect.objectContaining({ project: "/repo" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Git 改动", exact: true }));
    vi.mocked(call).mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000);
    });
    expect(call).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "文件", exact: true }));
    await act(async () => {});
    expect(call).toHaveBeenCalledWith(
      "project_files",
      expect.objectContaining({ project: "/repo" }),
    );
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});
