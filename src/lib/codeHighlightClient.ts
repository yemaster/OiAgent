let worker: Worker | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;
let nextId = 0;
const pending = new Map<number, (html: string | null) => void>();

function release() {
  worker?.terminate();
  worker = undefined;
  clearTimeout(idle);
  for (const finish of pending.values()) finish(null);
  pending.clear();
}
function idleRelease() {
  clearTimeout(idle);
  if (!pending.size) idle = setTimeout(release, 30_000);
}

/** One shared, disposable worker; syntax parsing never blocks typing or scrolling. */
export async function highlightOffThread(
  text: string,
  language: string,
  signal: AbortSignal,
): Promise<string | null> {
  if (signal.aborted || !language || text.length > 50_000) return null;
  // Non-WebView test/SSR environments retain the existing highlighter.
  if (typeof Worker === "undefined") {
    const { highlightCode } = await import("./codeHighlight");
    return signal.aborted ? null : highlightCode(text, language);
  }
  try {
    if (!worker) {
      worker = new Worker(
        new URL("./codeHighlight.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (
        event: MessageEvent<{ id: number; html: string | null }>,
      ) => {
        const finish = pending.get(event.data.id);
        pending.delete(event.data.id);
        finish?.(event.data.html);
        idleRelease();
      };
      worker.onerror = release;
    }
    clearTimeout(idle);
    return await new Promise((resolve) => {
      const id = ++nextId;
      const finish = (html: string | null) => {
        signal.removeEventListener("abort", cancel);
        resolve(html);
      };
      const cancel = () => {
        pending.delete(id);
        finish(null);
        idleRelease();
      };
      pending.set(id, finish);
      signal.addEventListener("abort", cancel, { once: true });
      try {
        worker!.postMessage({ id, text, language });
      } catch {
        release();
      }
    });
  } catch {
    release();
    return null;
  }
}
