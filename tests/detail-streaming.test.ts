import { expect, it } from "vitest";
import { retainContext } from "@/lib/taskState";
import { applyTaskUpdates } from "@/lib/taskUpdates";
import { demoSnapshot } from "@/lib/demo";

it("retains reported context across resumed snapshots but respects updates, compaction and session changes", () => {
  const previous = {
    ...demoSnapshot.tasks[0],
    sessionId: "session",
    model: "resolved",
    updatedAt: "2026-11-06T00:00:01Z",
    contextUsage: { input: 1000, output: 100, cached: 500, window: 200000 },
  };
  const next = {
    ...previous,
    model: "default",
    updatedAt: "2026-11-06T00:00:02Z",
    contextUsage: null,
  };
  expect(retainContext(next, previous).contextUsage).toBe(
    previous.contextUsage,
  );
  expect(applyTaskUpdates([previous], [next])[0].contextUsage).toBe(
    previous.contextUsage,
  );
  const compacted = {
    ...next,
    contextUsage: { input: null, output: null, cached: null, window: 200000 },
  };
  expect(retainContext(compacted, previous)).toBe(compacted);
  const updated = {
    ...previous,
    contextUsage: { ...previous.contextUsage, input: 2000 },
  };
  expect(retainContext(updated, previous)).toBe(updated);
  for (const changed of [
    { sessionId: "other" },
    { agentId: "other" },
    { providerId: "other" },
  ]) {
    const other = { ...next, ...changed };
    expect(retainContext(other, previous).contextUsage).toBeNull();
  }
});
