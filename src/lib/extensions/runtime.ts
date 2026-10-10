import bootstrap from "./worker-bootstrap.js?raw";
import { validateUi, type UiNode } from "./ui";
/** A worker exists only while its view is visible; dispose also rejects late replies. */
export function startExtension(
  source: string,
  payload: unknown,
  handlers: {
    render: (tree: UiNode) => void;
    request: (method: string, params: unknown) => Promise<unknown>;
    error: (message: string) => void;
    actionError: (message: string) => void;
  },
) {
  const url = URL.createObjectURL(
    new Blob([bootstrap, "\n", source], { type: "text/javascript" }),
  );
  let worker: Worker;
  try {
    worker = new Worker(url, { name: "OiAgent extension" });
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  let stopped = false,
    frame = 0,
    latest: unknown,
    pong = Date.now(),
    lastHeartbeat = Date.now(),
    count = 0,
    windowStart = Date.now(),
    inFlight = 0;
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    URL.revokeObjectURL(url);
    cancelAnimationFrame(frame);
    clearInterval(heartbeat);
  };
  const fail = (message: string) => {
    dispose();
    handlers.error(message);
  };
  const heartbeat = setInterval(() => {
    const now = Date.now();
    // A suspended window or sleeping computer must not look like a stuck plugin.
    if (now - lastHeartbeat > 10000) pong = now;
    lastHeartbeat = now;
    if (now - pong > 15000) {
      fail("插件没有响应，已停止。可重新加载或停用插件。");
      return;
    }
    worker.postMessage({ type: "ping" });
  }, 5000);
  worker.onerror = (event) => {
    event.preventDefault();
    fail(event.message || "插件运行失败");
  };
  worker.onmessageerror = () => fail("无法读取插件消息");
  worker.onmessage = async ({ data }) => {
    if (stopped) return;
    if (Date.now() - windowStart >= 1000) {
      windowStart = Date.now();
      count = 0;
    }
    if (++count > 120) {
      fail("插件发送消息过于频繁，已停止。");
      return;
    }
    if (!data || typeof data !== "object") return;
    if (data.type === "pong") {
      pong = Date.now();
      return;
    }
    if (data.type === "action-error") {
      handlers.actionError(String(data.message).slice(0, 2000));
      return;
    }
    if (data.type === "error") {
      fail(
        typeof data.message === "string"
          ? data.message.slice(0, 2000)
          : "插件运行失败",
      );
      return;
    }
    if (data.type === "render") {
      latest = data.tree;
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (!stopped)
            try {
              handlers.render(validateUi(latest));
            } catch (e) {
              fail(String(e));
            }
        });
      return;
    }
    if (
      data.type !== "request" ||
      !Number.isSafeInteger(data.id) ||
      typeof data.method !== "string"
    )
      return;
    let size: number;
    try {
      size = JSON.stringify(data).length;
    } catch {
      fail("插件请求不是有效的 JSON 数据");
      return;
    }
    if (inFlight >= 16 || size > 128 * 1024) {
      fail("插件请求超过限制");
      return;
    }
    inFlight++;
    try {
      const result = await handlers.request(data.method, data.params);
      if (!stopped)
        worker.postMessage({ type: "response", id: data.id, result });
    } catch (e) {
      if (!stopped)
        worker.postMessage({ type: "response", id: data.id, error: String(e) });
    } finally {
      inFlight--;
    }
  };
  worker.postMessage({ type: "open", payload });
  return {
    dispose,
    action: (payload: unknown) => {
      if (!stopped) worker.postMessage({ type: "action", payload });
    },
  };
}
