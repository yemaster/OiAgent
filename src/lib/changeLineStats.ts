import { diffLines } from "diff";
import type { StepChange } from "./stepChanges";

export type LineStats = { additions: number; deletions: number };
const cache = new WeakMap<StepChange, LineStats | undefined>();

/** Count recorded changes, never infer a missing original as an empty file. */
export function changeLineStats(change: StepChange): LineStats | undefined {
  if (cache.has(change)) return cache.get(change);
  const result = count(change);
  cache.set(change, result);
  return result;
}
function count(change: StepChange): LineStats | undefined {
  if (
    change.state !== "completed" ||
    ["记录已截断", "全部匹配处"].includes(change.note || "")
  )
    return;
  const { before, after, patch } = change;
  if (before !== undefined && after !== undefined) {
    if (before.length + after.length > 200_000) return;
    const diff = diffLines(before, after, { timeout: 4, maxEditLength: 1000 });
    if (!diff) return;
    return diff.reduce(
      (stats, part) => ({
        additions: stats.additions + (part.added ? part.count : 0),
        deletions: stats.deletions + (part.removed ? part.count : 0),
      }),
      { additions: 0, deletions: 0 },
    );
  }
  if (!patch || patch.length > 200_000) return;
  const stats = { additions: 0, deletions: 0 };
  let inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (/^(diff --git |Index: |\*\*\* )/.test(line)) {
      inHunk = line.startsWith("*** Add File: ");
      continue;
    }
    if (line.startsWith("+") && (inHunk || !line.startsWith("+++ ")))
      stats.additions++;
    if (line.startsWith("-") && (inHunk || !line.startsWith("--- ")))
      stats.deletions++;
  }
  return stats;
}

/** MultiEdit can record several fragments for the same file in one step. */
export function changeLineTotals(changes: StepChange[]): LineStats | undefined {
  const total = { additions: 0, deletions: 0 };
  for (const change of changes) {
    const stats = changeLineStats(change);
    if (!stats) return;
    total.additions += stats.additions;
    total.deletions += stats.deletions;
  }
  return total;
}
