// Runs in a dedicated Worker. No application objects or Tauri APIs are exposed.
(() => {
  const send = globalThis.postMessage.bind(globalThis);
  let sequence = 0,
    open,
    action;
  const pending = new Map();
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("插件请求超时"));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      send({ type: "request", id, method, params });
    });
  const api = Object.freeze({
    onOpen: (fn) => {
      open = fn;
    },
    onAction: (fn) => {
      action = fn;
    },
    ui: Object.freeze({ render: (tree) => send({ type: "render", tree }) }),
    storage: Object.freeze({
      get: () => request("storage.get"),
      set: (value) => request("storage.set", value),
    }),
    workspace: Object.freeze({
      getContext: () => request("workspace.context"),
    }),
    tasks: Object.freeze({
      list: () => request("tasks.list"),
      createDraft: (value) => request("tasks.draft", value),
    }),
    views: Object.freeze({ open: (id) => request("views.open", { id }) }),
    notify: (message) => request("notify", { message }),
  });
  Object.defineProperty(globalThis, "oiagent", {
    value: api,
    writable: false,
    configurable: false,
  });
  // Reduce accidental use of APIs outside the SDK. This is not a hostile-code sandbox.
  for (const name of [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "importScripts",
    "Worker",
    "SharedWorker",
    "BroadcastChannel",
    "indexedDB",
    "caches",
  ]) {
    try {
      Object.defineProperty(globalThis, name, {
        value: undefined,
        writable: false,
        configurable: false,
      });
    } catch {}
  }
  globalThis.addEventListener("message", async ({ data }) => {
    if (data.type === "ping") {
      send({ type: "pong" });
      return;
    }
    if (data.type === "response") {
      const item = pending.get(data.id);
      if (!item) return;
      clearTimeout(item.timer);
      pending.delete(data.id);
      if (data.error) item.reject(new Error(data.error));
      else item.resolve(data.result);
      return;
    }
    try {
      if (data.type === "open") {
        if (!open) throw new Error("插件没有注册 onOpen");
        await open(data.payload);
      }
      if (data.type === "action") await action?.(data.payload);
    } catch (error) {
      send({
        type: data.type === "action" ? "action-error" : "error",
        message: String(error),
      });
    }
  });
})();
