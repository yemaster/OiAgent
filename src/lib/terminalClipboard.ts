import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { desktop } from "@/lib/api";

export const terminalClipboard = {
  read: () => (desktop ? readText() : navigator.clipboard.readText()),
  write: (text: string) =>
    desktop ? writeText(text) : navigator.clipboard.writeText(text),
};

export function terminalClipboardAction(
  event: KeyboardEvent,
  selected: boolean,
  mac: boolean,
): "copy" | "paste" | undefined {
  if (event.isComposing || event.altKey) return;
  const key = event.key.toLowerCase();
  const modifier = mac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  if (modifier && key === "c" && (selected || event.shiftKey || mac))
    return "copy";
  if (modifier && key === "v") return "paste";
  if (!mac && !event.metaKey && key === "insert") {
    if (event.ctrlKey && !event.shiftKey && selected) return "copy";
    if (event.shiftKey && !event.ctrlKey) return "paste";
  }
}

/** Return false only for clipboard keys; bare Ctrl+C still reaches the PTY. */
export function terminalKeyHandler(
  term: {
    hasSelection(): boolean;
    getSelection(): string;
    paste(text: string): void;
  },
  available: () => boolean,
  report: (error: string) => void,
  mac = /Mac/i.test(navigator.platform),
) {
  let pending = Promise.resolve();
  return (event: KeyboardEvent) => {
    const action = terminalClipboardAction(event, term.hasSelection(), mac);
    if (!action) return true;
    event.preventDefault();
    event.stopPropagation();
    if (event.type !== "keydown" || event.repeat || !available()) return false;
    // Capture the selection before an asynchronous clipboard operation can change focus.
    const text = action === "copy" ? term.getSelection() : "";
    pending = pending
      .then(async () => {
        if (action === "copy") {
          if (text) await terminalClipboard.write(text);
        } else {
          const value = await terminalClipboard.read();
          // Switching tabs while reading must never paste into a hidden/other session.
          if (available() && value) term.paste(value);
        }
      })
      .catch(() =>
        report(
          action === "copy" ? "复制失败，请重试" : "读取剪贴板失败，请重试",
        ),
      );
    return false;
  };
}
