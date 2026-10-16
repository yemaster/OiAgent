import { expect, it } from "vitest";
import { newerTask } from "@/lib/taskState";
import { demoSnapshot } from "@/lib/demo";

it("rejects delayed running snapshots even within the same millisecond", () => {
  const old = {
    ...demoSnapshot.tasks[0],
    status: "running",
    updatedAt: "2026-10-16T01:00:00.123001Z",
  };
  const stopped = {
    ...old,
    status: "cancelled",
    updatedAt: "2026-10-16T01:00:00.123002Z",
  };
  expect(newerTask(stopped, old)).toBe(stopped);
  expect(newerTask(old, stopped)).toBe(stopped);
  expect(newerTask(stopped, { ...stopped, id: "other-task" })).toBe(stopped);
  const resumed = { ...old, updatedAt: "2026-10-16T01:00:01Z" };
  expect(newerTask(stopped, resumed)).toBe(resumed);
});
