import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useRecentProjects } from "@/hooks/useRecentProjects";
import { demoSnapshot } from "@/lib/demo";

it("orders projects by visits, remembers visits across launches, and uses task activity as fallback", () => {
  localStorage.removeItem("oiagent-recent-projects");
  const now = vi.spyOn(Date, "now").mockReturnValue(2000);
  const projects = ["/a", "/b", "/c"];
  const tasks = [
    {
      ...demoSnapshot.tasks[0],
      project: "/b",
      updatedAt: new Date(1000).toISOString(),
    },
  ];
  try {
    const first = renderHook(
      ({ project, context }) =>
        useRecentProjects(projects, tasks, project, context),
      {
        initialProps: { project: "all", context: "all" },
      },
    );
    expect(first.result.current).toEqual(["/b", "/a", "/c"]);
    first.rerender({ project: "/a", context: "task-a" });
    expect(first.result.current).toEqual(["/a", "/b", "/c"]);
    now.mockReturnValue(3000);
    first.rerender({ project: "/c", context: "file-c" });
    expect(first.result.current).toEqual(["/c", "/a", "/b"]);
    first.unmount();
    const next = renderHook(() =>
      useRecentProjects(projects, tasks, "all", "all"),
    );
    expect(next.result.current).toEqual(["/c", "/a", "/b"]);
    next.unmount();
  } finally {
    now.mockRestore();
    localStorage.removeItem("oiagent-recent-projects");
  }
});
