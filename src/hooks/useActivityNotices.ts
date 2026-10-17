import { useEffect, useState } from "react";
export type ActivityKind = "processes" | "artifacts" | "changes";
type Seen = Record<ActivityKind, string[]>;
const blank = (): Seen => ({ processes: [], artifacts: [], changes: [] });
function read(id: string): Seen {
  try {
    const value = JSON.parse(
      localStorage.getItem(`oiagent-activity-read:${id}`) || "null",
    );
    const strings = (items: unknown): string[] =>
      Array.isArray(items)
        ? items.filter((item): item is string => typeof item === "string")
        : [];
    return {
      processes: Array.isArray(value?.processes)
        ? strings(value.processes)
        : [
            ...strings(value?.commands).map((id) => `command:${id}`),
            ...strings(value?.services).map((id) => `service:${id}`),
          ],
      artifacts: strings(value?.artifacts),
      changes: strings(value?.changes),
    };
  } catch {
    return blank();
  }
}
export function useActivityNotices(
  id: string,
  keys: Pick<Seen, "processes" | "artifacts"> & Partial<Pick<Seen, "changes">>,
  viewing?: string,
) {
  const [saved, setSaved] = useState(() => ({ id, seen: read(id) }));
  const seen = saved.id === id ? saved.seen : read(id);
  const kind =
    viewing && Object.hasOwn(keys, viewing)
      ? (viewing as ActivityKind)
      : undefined;
  const fingerprint = kind ? JSON.stringify(keys[kind]) : "";
  useEffect(() => {
    if (!kind) return;
    const values = JSON.parse(fingerprint) as string[];
    const current = read(id);
    if (JSON.stringify(current[kind]) === fingerprint) return;
    const next = { ...current, [kind]: values };
    try {
      localStorage.setItem(`oiagent-activity-read:${id}`, JSON.stringify(next));
    } catch {
      /* In-memory read markers still work if storage is full. */
    }
    // Mark the current panel as read, including records arriving while it is open.
    // oxlint-disable-next-line react/set-state-in-effect
    setSaved({ id, seen: next });
  }, [id, kind, fingerprint]);
  return Object.fromEntries(
    Object.entries(keys).map(([key, values]) => {
      const readIds = new Set(seen[key as ActivityKind]);
      return [
        key,
        viewing === key
          ? 0
          : values.filter((value) => !readIds.has(value)).length,
      ];
    }),
  ) as Record<ActivityKind, number>;
}
