import { expect, it } from "vitest";
import { changeLineStats, changeLineTotals } from "@/lib/changeLineStats";
import type { StepChange } from "@/lib/stepChanges";

const change = (extra: Partial<StepChange>): StepChange => ({
  id: "edit",
  step: "step",
  timestamp: "",
  path: "a.ts",
  operation: "edit",
  state: "completed",
  scope: "file",
  ...extra,
});
it("counts changed lines while excluding unchanged context and trailing newline artifacts", () => {
  const row = change({
    before: "same\nold\nkeep\n",
    after: "same\nnew\nextra\nkeep\n",
  });
  expect(changeLineStats(row)).toEqual({ additions: 2, deletions: 1 });
  expect(changeLineStats(row)).toBe(changeLineStats(row));
  expect(changeLineStats(change({ before: "", after: "one\ntwo\n" }))).toEqual({
    additions: 2,
    deletions: 0,
  });
  expect(changeLineStats(change({ before: "one\ntwo", after: "" }))).toEqual({
    additions: 0,
    deletions: 2,
  });
});
it("counts patch hunks, including source lines starting with diff header characters", () => {
  expect(
    changeLineStats(
      change({
        scope: "patch",
        patch:
          "--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,3 @@\n-old\n--- source\n+new\n+++ source\n+extra\n",
      }),
    ),
  ).toEqual({ additions: 3, deletions: 2 });
});
it("aggregates all recorded fragments from one edit and never presents unknown or unapplied data as zero", () => {
  const first = change({ scope: "fragment", before: "old", after: "new" });
  const second = change({ scope: "fragment", before: "", after: "one\ntwo" });
  expect(changeLineTotals([first, second])).toEqual({
    additions: 3,
    deletions: 1,
  });
  for (const extra of [
    { scope: "unavailable" as const, after: "overwrite" },
    { before: "old", after: "new", state: "failed" as const },
    { before: "old", after: "new", state: "running" as const },
    { before: "old", after: "new", note: "记录已截断" },
    { before: "old", after: "new", note: "全部匹配处" },
    { before: "old", after: "x".repeat(200_001) },
  ])
    expect(changeLineStats(change(extra))).toBeUndefined();
});
