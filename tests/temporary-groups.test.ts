import { expect, it } from "vitest";
import { projectChoices, projectGroup } from "@/lib/temporaryProjects";
import { demoSnapshot } from "@/lib/demo";
import { projectName, type TemporaryProject } from "@/lib/types";
it("groups ordinary temporary projects without changing task file paths", () => {
  const make = (path: string, extra = {}): TemporaryProject => ({
    id: path,
    path,
    status: "active",
    createdAt: "",
    cleanupAfter: null,
    ...extra,
  });
  const temporaryProjects = [
    make("/temp/a"),
    make("/temp/b"),
    make("/temp/private", { ephemeral: true }),
    make("/temp/kept", { status: "kept" }),
  ];
  const snapshot = {
    ...demoSnapshot,
    temporaryProjects,
    projects: temporaryProjects.map((p) => p.path),
  };
  expect(projectChoices(snapshot)).toEqual(["/temp/a", "/temp/kept"]);
  expect(projectGroup("/temp/b", temporaryProjects)).toBe("/temp/a");
  expect(projectGroup("/temp/private", temporaryProjects)).toBe(
    "/temp/private",
  );
  expect(
    projectName("/tmp/临时项目-1a611493-f900-4b88-bc84-2f68d4a153bd"),
  ).toBe("临时项目");
});
