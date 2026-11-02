import { afterEach, expect, it, vi } from "vitest";

class WorkerMock {
  static instances: WorkerMock[] = [];
  onmessage?: (event: { data: { id: number; html: string | null } }) => void;
  onerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    WorkerMock.instances.push(this);
  }
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  WorkerMock.instances = [];
});

it("shares one worker, ignores cancelled results and releases it after idle time", async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal("Worker", WorkerMock);
  const { highlightOffThread } = await import("@/lib/codeHighlightClient");
  const first = new AbortController();
  const second = new AbortController();
  const a = highlightOffThread("old", "js", first.signal);
  const b = highlightOffThread("new", "js", second.signal);
  expect(WorkerMock.instances).toHaveLength(1);
  const worker = WorkerMock.instances[0];
  const [oldJob, newJob] = worker.postMessage.mock.calls.map(([job]) => job);
  first.abort();
  expect(await a).toBeNull();
  worker.onmessage!({ data: { id: oldJob.id, html: "old html" } });
  worker.onmessage!({ data: { id: newJob.id, html: "new html" } });
  expect(await b).toBe("new html");
  vi.advanceTimersByTime(30_000);
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it("falls back to readable plain text on worker errors and bounds large inputs", async () => {
  vi.resetModules();
  vi.stubGlobal("Worker", WorkerMock);
  const { highlightOffThread } = await import("@/lib/codeHighlightClient");
  const signal = new AbortController().signal;
  expect(await highlightOffThread("x".repeat(50_001), "js", signal)).toBeNull();
  expect(WorkerMock.instances).toHaveLength(0);
  const value = highlightOffThread("source", "js", signal);
  WorkerMock.instances[0].onerror!();
  expect(await value).toBeNull();
  expect(WorkerMock.instances[0].terminate).toHaveBeenCalledOnce();
});
