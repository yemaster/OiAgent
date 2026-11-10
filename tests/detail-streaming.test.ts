import { afterEach, expect, it, vi } from "vitest";
import { createDetailRefresh } from "@/lib/detailRefresh";
import { buildTranscript } from "@/lib/transcript";
import { retainContext } from "@/lib/taskState";
import { applyTaskUpdates } from "@/lib/taskUpdates";
import { demoSnapshot } from "@/lib/demo";
import type { Message } from "@/lib/types";

afterEach(() => vi.useRealTimers());

it("coalesces bursts, delivers the last chunk and never overlaps slow reads", async () => {
  vi.useFakeTimers();
  const load = vi.fn(async () => {});
  const refresh = createDetailRefresh(load, 1000);
  refresh.start();
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 500; i++) refresh.notify();
  await vi.advanceTimersByTimeAsync(249);
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(load).toHaveBeenCalledTimes(2);
  let resolve!: () => void;
  load.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  refresh.notify();
  await vi.advanceTimersByTimeAsync(250);
  expect(load).toHaveBeenCalledTimes(3);
  for (let i = 0; i < 500; i++) refresh.notify();
  await vi.advanceTimersByTimeAsync(5000);
  expect(load).toHaveBeenCalledTimes(3);
  resolve();
  await vi.advanceTimersByTimeAsync(1);
  expect(load).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(1000);
  expect(load).toHaveBeenCalledTimes(5); // fallback still works without events
  refresh.notify();
  refresh.dispose();
  await vi.advanceTimersByTimeAsync(10000);
  expect(load).toHaveBeenCalledTimes(5);
});

it("does not schedule trailing work after a hidden or unmounted pane finishes its read", async () => {
  vi.useFakeTimers();
  let resolve!: () => void;
  const load = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const refresh = createDetailRefresh(load, 1000);
  refresh.start();
  refresh.notify();
  refresh.dispose();
  resolve();
  await vi.advanceTimersByTimeAsync(10000);
  expect(load).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("shows text before the final snapshot, replaces it once, and keeps blocks and subagents separate", () => {
  const chunk = (
    text: string,
    streamId = "m:0",
    delta = true,
    parentCallId?: string,
  ): Message => ({
    role: "assistant",
    text,
    streamId,
    delta,
    timestamp: "t",
    parentCallId,
  });
  const rows = [
    chunk("hello"),
    chunk(" child", "m:0", true, "child"),
    chunk(" world"),
    chunk("second", "m:1"),
  ];
  const live = buildTranscript(rows);
  expect(
    live
      .filter((item) => item.kind === "message")
      .map((item) => item.message.text),
  ).toEqual(["hello world", "second"]);
  const done = buildTranscript([
    ...rows,
    chunk("hello world!", "m:0", false),
    chunk(" child!", "m:0", false, "child"),
  ]);
  expect(
    done
      .filter((item) => item.kind === "message")
      .map((item) => item.message.text),
  ).toEqual(["hello world!", "second"]);
  const child = done.find((item) => item.kind === "tool");
  expect(child?.kind === "tool" && child.nested).toHaveLength(1);
  expect(
    child?.kind === "tool" &&
      child.nested[0].kind === "message" &&
      child.nested[0].message.text,
  ).toBe(" child!");
});

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
