import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { call, desktop } from "@/lib/api";
import { toast } from "sonner";
import {
  dirtyFile,
  fileId,
  type FileContent,
  type FileDiff,
  type OpenFile,
} from "@/lib/files";

export function useFiles() {
  const [files, setFiles] = useState<OpenFile[]>([]);
  const [selected, select] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const latest = useRef(files);
  useLayoutEffect(() => {
    latest.current = files;
  }, [files]);
  const update = useCallback(
    (id: string, fn: (file: OpenFile) => OpenFile) =>
      setFiles((rows) => rows.map((f) => (f.id === id ? fn(f) : f))),
    [],
  );
  const open = useCallback(
    async (
      project: string,
      path: string,
      mode: "edit" | "diff" = "edit",
      originalPath?: string,
    ) => {
      const id = fileId(project, path, mode);
      select(id);
      if (latest.current.some((f) => f.id === id)) return;
      const entry: OpenFile = {
        id,
        project,
        path,
        mode,
        originalPath,
        content: "",
        saved: "",
        revision: "",
        loading: true,
        saving: false,
      };
      setFiles((rows) =>
        rows.some((f) => f.id === id) ? rows : [...rows, entry],
      );
      try {
        if (mode === "diff") {
          const d = await call<FileDiff>("project_file_diff", {
            project,
            path,
            originalPath: originalPath || null,
          });
          update(id, (f) => ({
            ...f,
            content: d.modified,
            saved: d.modified,
            original: d.original,
            originalLabel: d.originalLabel,
            loading: false,
          }));
        } else {
          const d = await call<FileContent>("read_project_file", {
            project,
            path,
          });
          update(id, (f) => ({ ...f, ...d, saved: d.content, loading: false }));
        }
      } catch (e) {
        update(id, (f) => ({ ...f, loading: false, error: String(e) }));
      }
    },
    [update],
  );
  const save = useCallback(
    async (id: string) => {
      const f = latest.current.find((f) => f.id === id);
      if (
        !f ||
        f.mode !== "edit" ||
        f.loading ||
        f.saving ||
        f.error ||
        f.conflict
      )
        return false;
      update(id, (x) => ({ ...x, saving: true }));
      try {
        const saved = await call<FileContent>("save_project_file", {
          project: f.project,
          path: f.path,
          content: f.content,
          revision: f.revision,
        });
        update(id, (x) => ({
          ...x,
          saved: saved.content,
          revision: saved.revision,
          saving: false,
        }));
        setVersion((v) => v + 1);
        toast.success("文件已保存");
        return true;
      } catch (e) {
        update(id, (x) => ({ ...x, saving: false }));
        try {
          const disk = await call<FileContent>("read_project_file", {
            project: f.project,
            path: f.path,
          });
          if (disk.revision !== f.revision)
            update(id, (x) => ({ ...x, conflict: disk }));
        } catch {
          /* Keep the user's buffer if the file was removed. */
        }
        toast.error(String(e));
        return false;
      }
    },
    [update],
  );
  const reload = useCallback(
    async (id: string) => {
      const f = latest.current.find((f) => f.id === id);
      if (!f || f.saving) return;
      try {
        if (f.mode === "diff") {
          const d = await call<FileDiff>("project_file_diff", {
            project: f.project,
            path: f.path,
            originalPath: f.originalPath || null,
          });
          update(id, (x) => ({
            ...x,
            content: d.modified,
            original: d.original,
            originalLabel: d.originalLabel,
            error: undefined,
          }));
        } else {
          const d = await call<FileContent>("read_project_file", {
            project: f.project,
            path: f.path,
          });
          update(id, (x) =>
            dirtyFile(x) && d.revision !== x.revision
              ? { ...x, conflict: d }
              : dirtyFile(x)
                ? x
                : {
                    ...x,
                    ...d,
                    saved: d.content,
                    error: undefined,
                    conflict: undefined,
                  },
          );
        }
      } catch (e) {
        toast.error(String(e));
      }
    },
    [update],
  );
  // Only the visible file is polled. Never replace a dirty buffer with Agent edits.
  useEffect(() => {
    if (!selected) return;
    let stopped = false;
    const check = async () => {
      const f = latest.current.find((f) => f.id === selected);
      if (!f || f.mode !== "edit" || f.loading || f.saving || f.error) return;
      try {
        const d = await call<FileContent>("read_project_file", {
          project: f.project,
          path: f.path,
        });
        if (!stopped && d.revision !== f.revision)
          update(f.id, (x) =>
            x.saving || x.revision !== f.revision
              ? x
              : dirtyFile(x)
                ? { ...x, conflict: d }
                : { ...x, ...d, saved: d.content, conflict: undefined },
          );
      } catch {
        /* Saving will explain a missing or unreadable file. */
      }
    };
    void check();
    const timer = setInterval(() => void check(), 4000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [selected, update]);
  const discard = useCallback((id: string) => {
    setFiles((rows) => rows.filter((f) => f.id !== id));
    select((current) => (current === id ? null : current));
    setClosing(null);
  }, []);
  const close = useCallback(
    (id: string) => {
      const f = latest.current.find((f) => f.id === id);
      if (f?.saving) return;
      if (f && dirtyFile(f)) setClosing(id);
      else discard(id);
    },
    [discard],
  );
  const dirty = files.some(dirtyFile);
  useEffect(() => {
    if (!desktop || !dirty) return;
    let off: (() => void) | undefined;
    let disposed = false;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (latest.current.some(dirtyFile)) {
          event.preventDefault();
          toast.error("有未保存的文件，请先保存，或关闭文件标签并选择不保存。");
        }
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else off = unlisten;
      })
      .catch((e) => toast.error(`无法保护未保存文件：${String(e)}`));
    return () => {
      disposed = true;
      off?.();
    };
  }, [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  return {
    files,
    selected,
    select,
    active: files.find((f) => f.id === selected),
    open,
    save,
    reload,
    update,
    close,
    discard,
    closing,
    setClosing,
    version,
  };
}
