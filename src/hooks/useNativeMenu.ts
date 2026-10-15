import { nativeShortcuts, useShortcuts } from "@/lib/shortcuts";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { call, desktop } from "@/lib/api";
import { toast } from "sonner";

export function useNativeMenu(
  onAction: (action: string) => void,
  state: { canSave: boolean; canClose: boolean; canBack: boolean },
) {
  const shortcuts = useShortcuts();
  const [tabsFocused, setTabsFocused] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const accelerators = useMemo(
    () => nativeShortcuts(shortcuts, composerFocused, tabsFocused),
    [shortcuts, composerFocused, tabsFocused],
  );
  const [terminalFocused, setTerminalFocused] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    const update = () =>
      queueMicrotask(() => {
        if (!disposed) {
          setTabsFocused(
            !!document.activeElement?.closest("[data-workspace-tabs]"),
          );
          setComposerFocused(
            !!document.activeElement?.closest("[data-chat-composer]"),
          );
          setTerminalFocused(
            !!document.activeElement?.closest("[data-terminal-surface]") ||
              !!document.querySelector("[data-shortcut-recorder]"),
          );
        }
      });
    update();
    window.addEventListener("oiagent-shortcut-recording", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      disposed = true;
      window.removeEventListener("oiagent-shortcut-recording", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);
  const handleAction = useEffectEvent(onAction);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    const subscriptions = [
      listen<string>("menu-action", ({ payload }) => {
        if (!disposed && !document.querySelector("[data-shortcut-recorder]"))
          handleAction(payload);
      }),
      listen<string>("menu-error", ({ payload }) => {
        if (!disposed) toast.error(payload);
      }),
    ];
    for (const subscription of subscriptions)
      void subscription.catch((error) => {
        if (!disposed) toast.error(String(error));
      });
    return () => {
      disposed = true;
      for (const subscription of subscriptions)
        void subscription.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);
  const { canSave, canClose, canBack } = state;
  useEffect(() => {
    if (!desktop) return;
    void call("set_menu_state", {
      canSave,
      canClose,
      canBack,
      terminalFocused,
      shortcuts: accelerators,
    }).catch((error) => toast.error(String(error)));
  }, [canSave, canClose, canBack, terminalFocused, accelerators]);
}
