/** Event-driven reads with a polling fallback. One read in flight, at most 4/s. */
export function createDetailRefresh(load: () => Promise<void>, pollMs: number) {
  let disposed = false;
  let running = false;
  let dirty = false;
  let lastStart = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedule(delay: number) {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), delay);
  }
  async function run() {
    if (disposed || running) return;
    clearTimeout(timer);
    running = true;
    dirty = false;
    lastStart = Date.now();
    try {
      await load();
    } finally {
      running = false;
      if (!disposed)
        schedule(dirty ? Math.max(0, 250 - (Date.now() - lastStart)) : pollMs);
    }
  }
  return {
    start() {
      void run();
    },
    notify() {
      if (disposed) return;
      dirty = true;
      if (!running) schedule(Math.max(0, 250 - (Date.now() - lastStart)));
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
    },
  };
}
