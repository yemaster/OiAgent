let request: Promise<unknown> | undefined;

/** Load on pointer/keyboard intent, without preloading every workspace page. */
export function preloadTaskDetail() {
  request ??= import("@/pages/Detail").catch(() => {
    request = undefined;
  });
}
