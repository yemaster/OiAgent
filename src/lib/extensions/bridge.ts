import type { ExtensionPackage, ExtensionContext } from "./types";
import type { Task } from "@/lib/types";
export function extensionBridge(
  plugin: ExtensionPackage,
  host: {
    context: () => ExtensionContext;
    tasks: () => Task[];
    save: (storage: Record<string, unknown>) => Promise<void>;
    open: (viewId: string) => void;
    draft: (value: { title: string; prompt: string }) => void;
    notify: (message: string) => void;
  },
) {
  let storage = plugin.storage;
  let saving = Promise.resolve();
  const requirePermission = (permission: string) => {
    if (!plugin.manifest.permissions.includes(permission))
      throw new Error(`插件没有 ${permission} 权限`);
  };
  return async (method: string, params: unknown): Promise<unknown> => {
    const p = params as Record<string, unknown> | undefined;
    switch (method) {
      case "workspace.context":
        requirePermission("workspace.read");
        return host.context();
      case "tasks.list":
        requirePermission("tasks.read");
        return host
          .tasks()
          .slice(0, 200)
          .map((t) => ({
            id: t.id,
            title: t.title,
            project: t.project,
            status: t.status,
            agentKind: t.agentKind,
            deviceName: t.deviceName || "本机",
            usage: t.usage,
          }));
      case "tasks.draft":
        requirePermission("tasks.draft");
        if (
          !p ||
          typeof p.prompt !== "string" ||
          !p.prompt.trim() ||
          p.prompt.length > 32000 ||
          (p.title !== undefined &&
            (typeof p.title !== "string" || p.title.length > 200))
        )
          throw new Error("任务标题或 Prompt 无效");
        host.draft({ title: (p.title as string) || "", prompt: p.prompt });
        return null;
      case "views.open":
        if (
          !p ||
          typeof p.id !== "string" ||
          !plugin.manifest.contributes.views.some((v) => v.id === p.id)
        )
          throw new Error("页面未在插件清单中注册");
        host.open(p.id);
        return null;
      case "notify":
        if (
          !p ||
          typeof p.message !== "string" ||
          !p.message.trim() ||
          p.message.length > 300
        )
          throw new Error("通知内容无效");
        host.notify(p.message);
        return null;
      case "storage.get":
        await saving;
        return structuredClone(storage);
      case "storage.set": {
        if (
          !p ||
          typeof p !== "object" ||
          Array.isArray(p) ||
          JSON.stringify(p).length > 128 * 1024
        )
          throw new Error("插件数据必须是对象且不超过 128 KB");
        const next = structuredClone(p);
        const write = saving
          .then(() => host.save(next))
          .then(() => {
            storage = next;
          });
        saving = write.catch(() => {});
        await write;
        return null;
      }
      default:
        throw new Error(`不支持的插件 API：${method}`);
    }
  };
}
