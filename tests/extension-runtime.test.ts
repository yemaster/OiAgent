import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startExtension } from "@/lib/extensions/runtime";
class MockWorker {
  static latest: MockWorker;
  onmessage?: (event: MessageEvent) => void;
  onerror?: (event: ErrorEvent) => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    MockWorker.latest = this;
  }
  send(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", MockWorker);
  URL.createObjectURL = vi.fn(() => "blob:plugin");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const handlers = () => ({
  render: vi.fn(),
  request: vi.fn(async () => "ok"),
  error: vi.fn(),
  actionError: vi.fn(),
});
it("coalesces renders and releases workers and URLs on close", () => {
  const h = handlers();
  const runtime = startExtension("", { viewId: "test" }, h);
  const worker = MockWorker.latest;
  worker.send({ type: "render", tree: { type: "text", text: "old" } });
  worker.send({ type: "render", tree: { type: "text", text: "latest" } });
  vi.advanceTimersByTime(20);
  expect(h.render).toHaveBeenCalledTimes(1);
  expect(h.render).toHaveBeenCalledWith({ type: "text", text: "latest" });
  runtime.dispose();
  runtime.dispose();
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:plugin");
  worker.send({ type: "request", id: 1, method: "tasks.list" });
  expect(h.request).not.toHaveBeenCalled();
});
it("terminates unresponsive or flooding extensions without a host render loop", () => {
  const h = handlers();
  startExtension("while(true){}", {}, h);
  const worker = MockWorker.latest;
  vi.advanceTimersByTime(20000);
  expect(worker.terminate).toHaveBeenCalled();
  expect(h.error).toHaveBeenCalledWith(expect.stringContaining("没有响应"));
  startExtension("", {}, h);
  const flood = MockWorker.latest;
  for (let i = 0; i < 121; i++) flood.send({ type: "pong" });
  expect(flood.terminate).toHaveBeenCalled();
});
it("does not answer late requests or terminate the view for an action error", async () => {
  const h = handlers();
  let resolve!: (value: string) => void;
  h.request.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const runtime = startExtension("", {}, h);
  const worker = MockWorker.latest;
  worker.send({ type: "action-error", message: "请输入内容" });
  expect(h.actionError).toHaveBeenCalledWith("请输入内容");
  expect(worker.terminate).not.toHaveBeenCalled();
  worker.send({ type: "request", id: 1, method: "storage.set" });
  runtime.dispose();
  resolve("saved");
  await Promise.resolve();
  expect(worker.postMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "response" }),
  );
});

it("rejects cyclic request data without leaking an unhandled host exception", () => {
  const h = handlers();
  startExtension("", {}, h);
  const params: Record<string, unknown> = {};
  params.self = params;
  MockWorker.latest.send({
    type: "request",
    id: 1,
    method: "storage.set",
    params,
  });
  expect(MockWorker.latest.terminate).toHaveBeenCalled();
  expect(h.error).toHaveBeenCalledWith(expect.stringContaining("JSON"));
});
