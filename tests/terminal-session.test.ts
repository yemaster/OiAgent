import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { call } from "@/lib/api";
import {
  takeTerminalSession,
  releaseTerminalSession,
  TerminalSession,
  discardTerminalSession,
} from "@/lib/terminalSession";

const mocks = vi.hoisted(() => ({ terminals: [] as MockTerminal[] }));
class MockTerminal {
  options = {};
  element?: HTMLElement;
  cols = 120;
  rows = 30;
  buffer = { normal: { length: 30 }, alternate: { length: 30 } };
  callbacks: (() => void)[] = [];
  data?: (data: string) => void;
  loadAddon() {}
  attachCustomKeyEventHandler() {}
  hasSelection() {
    return false;
  }
  getSelection() {
    return "";
  }
  paste = vi.fn();
  selectAll = vi.fn();
  focus() {}
  blur() {}
  dispose = vi.fn();
  onData(fn: (data: string) => void) {
    this.data = fn;
    return { dispose() {} };
  }
  open = vi.fn((host: HTMLElement) => {
    this.element = document.createElement("textarea");
    host.appendChild(this.element);
  });
  write = vi.fn((_data: Uint8Array, done: () => void) => {
    this.callbacks.push(done);
  });
  writeln = vi.fn();
}
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    constructor() {
      const term = new MockTerminal();
      mocks.terminals.push(term);
      return term;
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock("@/lib/api", () => ({ desktop: true, call: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(),
  writeText: vi.fn(),
}));
let sessions: TerminalSession[];
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(call).mockReset();
  vi.mocked(call).mockResolvedValue([]);
  mocks.terminals.length = 0;
  sessions = [];
});
afterEach(() => {
  sessions.forEach((session) => session.dispose());
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  document.body.replaceChildren();
});
function attach(id: string) {
  const session = takeTerminalSession(id, {});
  sessions.push(session);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const status = vi.fn();
  session.attach(container, {}, status);
  return { session, term: mocks.terminals.at(-1)!, status };
}
const reads = () =>
  vi.mocked(call).mock.calls.filter(([cmd]) => cmd === "terminal_read");

it("drains backlog immediately after parsing, with one chunk outstanding and exact byte offsets", async () => {
  vi.mocked(call)
    .mockResolvedValueOnce(new Uint8Array([0xe4, 0xb8]).buffer)
    .mockResolvedValueOnce([0xad, 27, 91])
    .mockResolvedValue([]);
  const { term } = attach("flow");
  await Promise.resolve();
  expect(term.write).toHaveBeenCalledWith(
    new Uint8Array([0xe4, 0xb8]),
    expect.any(Function),
  );
  await vi.advanceTimersByTimeAsync(500);
  expect(reads()).toHaveLength(1);
  term.callbacks.shift()!();
  await vi.advanceTimersByTimeAsync(1);
  expect(reads()[1][1]).toEqual({ id: "flow", offset: 2 });
  term.callbacks.shift()!();
  await vi.advanceTimersByTimeAsync(1);
  expect(reads()[2][1]).toEqual({ id: "flow", offset: 5 });
  await vi.advanceTimersByTimeAsync(100);
  expect(reads()).toHaveLength(3);
});

it("restores the same parser and screen on a view switch without replaying bytes or reopening xterm", async () => {
  vi.mocked(call).mockResolvedValueOnce([27, 91, 51, 50]).mockResolvedValue([]);
  const { session, term } = attach("resume");
  await Promise.resolve();
  // Detach with an incomplete ANSI sequence still being parsed.
  releaseTerminalSession(session);
  term.callbacks.shift()!();
  await vi.advanceTimersByTimeAsync(1000);
  expect(reads()).toHaveLength(1);
  const resumed = takeTerminalSession("resume", { background: "black" });
  expect(resumed).toBe(session);
  resumed.attach(document.body, {}, vi.fn());
  await Promise.resolve();
  expect(reads()[1][1]).toEqual({ id: "resume", offset: 4 });
  expect(term.open).toHaveBeenCalledTimes(1);
  expect(mocks.terminals).toHaveLength(1);
});

it("does not duplicate reads when remounted during an in-flight read", async () => {
  let complete!: (bytes: number[]) => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const { session, term } = attach("pending");
  releaseTerminalSession(session);
  const resumed = takeTerminalSession("pending", {});
  resumed.attach(document.body, {}, vi.fn());
  expect(reads()).toHaveLength(1);
  complete([65]);
  await Promise.resolve();
  term.callbacks.shift()!();
  await vi.advanceTimersByTimeAsync(1);
  expect(reads()[1][1]).toEqual({ id: "pending", offset: 1 });
});

it("bounds detached terminal memory without restarting processes or polling detached views", async () => {
  const views = Array.from({ length: 5 }, (_, i) => attach(`cache-${i}`));
  views.forEach(({ session }) => releaseTerminalSession(session));
  expect(views[0].term.dispose).toHaveBeenCalled();
  expect(views[4].term.dispose).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect(reads()).toHaveLength(5);
  expect(takeTerminalSession("cache-4", {})).toBe(views[4].session);
  expect(views[4].term.dispose).not.toHaveBeenCalled();
  expect(vi.mocked(call).mock.calls.every(([cmd]) => cmd !== "stop_task")).toBe(
    true,
  );
});

it("serializes pasted text and later Ctrl+C even when a native write is slow", async () => {
  let finish!: () => void;
  vi.mocked(call).mockImplementation(async (cmd) => {
    if (cmd === "terminal_write")
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    return [];
  });
  const { term } = attach("input");
  term.data!("multiline paste\r\n");
  term.data!("\x03");
  await Promise.resolve();
  const writes = () =>
    vi.mocked(call).mock.calls.filter(([cmd]) => cmd === "terminal_write");
  expect(writes()).toHaveLength(1);
  finish();
  await vi.advanceTimersByTimeAsync(1);
  expect(writes()[1][1]).toEqual({ id: "input", data: "\x03" });
  finish();
});

it("budgets large detached buffers while preserving the most recently used parser", () => {
  const older = attach("large-older");
  older.term.cols = 200;
  older.term.buffer.normal.length = 10_000;
  releaseTerminalSession(older.session);
  const recent = attach("large-recent");
  recent.term.cols = 200;
  recent.term.buffer.normal.length = 10_000;
  releaseTerminalSession(recent.session);
  expect(older.term.dispose).toHaveBeenCalledOnce();
  expect(recent.term.dispose).not.toHaveBeenCalled();
  expect(takeTerminalSession(recent.session.id, {})).toBe(recent.session);
});

it("reports read failures separately without injecting text into the ANSI stream", async () => {
  vi.mocked(call).mockRejectedValueOnce(new Error("read failed"));
  const { term, status } = attach("errors");
  await Promise.resolve();
  expect(status).toHaveBeenLastCalledWith({
    hasOutput: false,
    error: "Error: read failed",
  });
  expect(term.writeln).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(999);
  expect(reads()).toHaveLength(1);
});

it("backs off idle polling and immediately reads again after terminal input", async () => {
  const { term } = attach("idle");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(reads().length).toBeLessThan(15);
  const before = reads().length;
  term.data!("ls\r");
  await vi.advanceTimersByTimeAsync(1);
  expect(reads().length).toBeGreaterThan(before);
});

it("drains an exited terminal once and stops idle polling", async () => {
  const { session } = attach("exited");
  session.setRunning(false);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(reads()).toHaveLength(1);
});

it("disposes closed terminal views and never reserves tombstones for unopened sessions", () => {
  discardTerminalSession("never-opened");
  const first = attach("never-opened");
  releaseTerminalSession(first.session);
  expect(first.term.dispose).not.toHaveBeenCalled();
  discardTerminalSession("never-opened");
  expect(first.term.dispose).toHaveBeenCalledOnce();
  const live = attach("closed-while-visible");
  discardTerminalSession(live.session.id);
  expect(live.term.dispose).not.toHaveBeenCalled();
  releaseTerminalSession(live.session);
  expect(live.term.dispose).toHaveBeenCalledOnce();
});
