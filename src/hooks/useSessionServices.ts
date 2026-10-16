import { useEffect, useMemo, useState } from "react";
import { call } from "@/lib/api";
import {
  configuredServices,
  sessionServices,
  type SessionCommand,
  type SessionService,
} from "@/lib/sessionActivity";

/** Show only reachable local launch ports, never arbitrary links or a port range. */
export function useSessionServices(
  commands: SessionCommand[],
  enabled: boolean,
  scope = "",
) {
  const reported = useMemo(() => sessionServices(commands), [commands]);
  const candidates = useMemo(() => configuredServices(commands), [commands]);
  const key = JSON.stringify({
    scope,
    ports: [
      ...new Set(
        [...reported, ...candidates]
          .filter((service) => service.local)
          .map((service) => service.port),
      ),
    ].sort((a, b) => a - b),
  });
  const [checked, setChecked] = useState<{ key: string; ports: number[] }>();
  useEffect(() => {
    if (!enabled) return;
    const { ports } = JSON.parse(key) as { ports: number[] };
    if (!ports.length) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function probe() {
      const reachable: number[] = [];
      try {
        for (let i = 0; i < ports.length && !disposed; i += 16) {
          const result = await call<{ port: number; reachable: boolean }[]>(
            "probe_service_ports",
            { ports: ports.slice(i, i + 16) },
          );
          if (Array.isArray(result))
            reachable.push(
              ...result
                .filter(
                  (entry) => entry.reachable && ports.includes(entry.port),
                )
                .map((entry) => entry.port),
            );
        }
        if (!disposed) setChecked({ key, ports: reachable });
      } catch {
        if (!disposed) setChecked({ key, ports: [] });
      } finally {
        if (!disposed) timer = setTimeout(probe, 5000);
      }
    }
    void probe();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [enabled, key]);
  return useMemo(() => {
    if (!enabled || checked?.key !== key) return [];
    const services = new Map<number, SessionService>();
    for (const service of [...reported, ...candidates])
      if (
        service.local &&
        checked.ports.includes(service.port) &&
        !services.has(service.port)
      )
        services.set(service.port, { ...service, reachable: true });
    return [...services.values()];
  }, [reported, candidates, enabled, checked, key]);
}
