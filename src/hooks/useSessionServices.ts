import { useEffect, useMemo, useState } from "react";
import { call } from "@/lib/api";
import {
  configuredServices,
  sessionServices,
  type SessionCommand,
  type SessionService,
} from "@/lib/sessionActivity";

/** Probe only explicit local launch ports, never arbitrary links or a port range. */
export function useSessionServices(
  commands: SessionCommand[],
  enabled: boolean,
  scope = "",
) {
  const reported = useMemo(() => sessionServices(commands), [commands]);
  const candidates = useMemo(() => configuredServices(commands), [commands]);
  const key = JSON.stringify({ scope, entries: candidates });
  const [checked, setChecked] = useState<{ key: string; ports: number[] }>();
  useEffect(() => {
    if (!enabled) return;
    const { entries } = JSON.parse(key) as { entries: SessionService[] };
    const ports = [...new Set(entries.map((service) => service.port))];
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
    const services = new Map(reported.map((service) => [service.id, service]));
    if (enabled && checked?.key === key)
      for (const candidate of candidates)
        if (
          checked.ports.includes(candidate.port) &&
          !reported.some(
            (service) => service.local && service.port === candidate.port,
          )
        )
          services.set(candidate.id, { ...candidate, reachable: true });
    return [...services.values()];
  }, [reported, candidates, enabled, checked, key]);
}
