import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { call } from "@/lib/api";
import type { Task } from "@/lib/types";
import type { ItemMark, WorkspaceMarks } from "@/lib/organization";
export function useWorkspaceOrganization(refresh: () => Promise<void>) {
  const [marks, setMarks] = useState<WorkspaceMarks>({});
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let live = true;
    void call<WorkspaceMarks>("workspace_marks")
      .then((value) => {
        if (live) {
          setMarks(value || {});
          setReady(true);
        }
      })
      .catch((error) => {
        if (live) toast.error(`读取置顶与颜色标记失败：${error}`);
      });
    return () => {
      live = false;
    };
  }, []);
  async function mark(key: string, patch: ItemMark) {
    if (!ready || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      setMarks(
        await call<WorkspaceMarks>("mark_workspace_item", { key, patch }),
      );
    } catch (error) {
      toast.error(String(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function archive(task: Task, archived: boolean) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    try {
      await call("archive_task", { id: task.id, archived });
      await refresh();
      toast.success(archived ? "会话已归档" : "会话已恢复");
      return true;
    } catch (error) {
      toast.error(String(error));
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return { marks, mark, archive, busy, ready };
}
