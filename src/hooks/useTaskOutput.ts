import { useCallback, useEffect, useRef } from "react";
import { createTaskOutput, type OutputSnapshot } from "@/lib/taskOutput";
import { useLiveCallback } from "./useLiveCallback";

export function useTaskOutput(
  id: string,
  enabled: boolean,
  update: (snapshot: OutputSnapshot) => void,
) {
  const onOutput = useLiveCallback(update);
  const connection = useRef<ReturnType<typeof createTaskOutput> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    try {
      const stream = createTaskOutput(id, onOutput);
      connection.current = stream;
      return () => {
        connection.current = null;
        stream.dispose();
      };
    } catch {
      // A web preview or older desktop bridge can keep using detail polling.
      return;
    }
  }, [id, enabled, onOutput]);
  // Read only in callbacks, including the response to an older in-flight poll.
  return useCallback(() => connection.current?.ready() === true, []);
}
