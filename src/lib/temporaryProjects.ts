import type { Snapshot, TemporaryProject } from "./types";

/** Group presentation only; task paths remain intact for files and execution. */
export function projectGroup(path: string, projects: TemporaryProject[] = []) {
  const current = projects.find((p) => p.path === path);
  if (!current || current.status === "kept" || current.ephemeral) return path;
  return (
    projects.find((p) => p.status === "active" && !p.ephemeral)?.path ||
    projects.find((p) => p.status !== "kept" && !p.ephemeral)?.path ||
    path
  );
}
export function projectChoices(snapshot: Snapshot) {
  return [
    ...new Set(
      snapshot.projects
        .filter(
          (path) =>
            !snapshot.temporaryProjects?.some(
              (p) => p.path === path && p.ephemeral,
            ),
        )
        .map((path) => projectGroup(path, snapshot.temporaryProjects)),
    ),
  ];
}
