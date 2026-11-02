import { useCallback, useLayoutEffect, useRef } from "react";

/** Stable event prop, with the latest committed callback and no stale closures. */
export function useLiveCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
) {
  const latest = useRef(callback);
  useLayoutEffect(() => {
    latest.current = callback;
  }, [callback]);
  return useCallback((...args: Args) => latest.current(...args), []);
}
