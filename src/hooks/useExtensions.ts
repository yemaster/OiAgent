import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "@/lib/api";
import {
  extensionTabId,
  type Extension,
  type ExtensionTab,
  type ExtensionContext,
  type FieldValues,
} from "@/lib/extensions/types";
export function useExtensions(
  restored: ExtensionTab[] = [],
  selectedTab: string | null = null,
) {
  const [ready, setReady] = useState(false);
  const [catalog, setCatalog] = useState<{
    items: Extension[];
    warnings: string[];
  }>({ items: [], warnings: [] });
  const [error, setError] = useState("");
  const [tabs, setTabs] = useState<ExtensionTab[]>(restored);
  const [selected, select] = useState<string | null>(selectedTab);
  const values = useRef<Record<string, FieldValues>>({});
  const refresh = useCallback(async () => {
    try {
      const catalog = await call<{ items: Extension[]; warnings: string[] }>(
        "extension_catalog",
      );
      setCatalog(catalog);
      setTabs((tabs) =>
        tabs.filter((tab) =>
          catalog.items.some(
            (plugin) =>
              plugin.enabled &&
              plugin.manifest.id === tab.pluginId &&
              plugin.manifest.contributes.views.some(
                (view) => view.id === tab.viewId,
              ),
          ),
        ),
      );
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setReady(true);
    }
  }, []);
  useEffect(() => {
    // Initial catalog I/O is independent of task startup.
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh();
  }, [refresh]);
  function open(pluginId: string, viewId: string, context: ExtensionContext) {
    const plugin = catalog.items.find(
      (p) => p.manifest.id === pluginId && p.enabled,
    );
    const view = plugin?.manifest.contributes.views.find(
      (v) => v.id === viewId,
    );
    if (!view) return;
    const id = extensionTabId(pluginId, viewId);
    setTabs((items) =>
      items.some((t) => t.id === id)
        ? items
        : [
            ...items,
            {
              id,
              pluginId,
              viewId,
              title: view.title,
              icon: view.icon,
              context,
            },
          ],
    );
    select(id);
  }
  const close = useCallback((id: string) => {
    setTabs((items) => items.filter((t) => t.id !== id));
    select((current) => (current === id ? null : current));
    delete values.current[id];
  }, []);
  return {
    ...catalog,
    ready,
    error,
    refresh,
    tabs,
    selected,
    select,
    open,
    close,
    getValues: (id: string) => values.current[id] || {},
    setValues: (id: string, next: FieldValues) => {
      values.current[id] = next;
    },
  };
}
