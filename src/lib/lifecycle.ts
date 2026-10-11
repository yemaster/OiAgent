export type CloseBehavior = "ask" | "tray" | "quit";
export interface CloseInfo {
  behavior: CloseBehavior;
  trayAvailable: boolean;
  running: number;
  pending: "close" | "quit" | null;
}
export function automaticClose(
  info: CloseInfo,
  dirty: number,
): "tray" | "quit" | null {
  if (!info.pending) return null;
  if (
    info.pending === "close" &&
    info.behavior === "tray" &&
    info.trayAvailable
  )
    return "tray";
  // A remembered preference never discards edits or interrupts live work silently.
  if (info.behavior === "quit" && !info.running && !dirty) return "quit";
  return null;
}
