import type { RestoredFile } from "@/lib/workspaceSession";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { call } from "@/lib/api";
import { toast } from "sonner";
import {
  dirtyFile,
  imageFile,
  vectorFile,
  readOpenFile,
  fileId,
  type FileContent,
  type FileDiff,
  type OpenFile,
} from "@/lib/files";

export function useFiles(
  restored: RestoredFile[] = [],
  selectedFile: string | null = null,
  managedVisibility = false,
) {
  const [files, setFiles] = useState<OpenFile[]>(() =>
    restored.map((file) => ({
      ...file,
      content: "",
      saved: "",
      revision: "",
      loading: true,
      unloaded: true,
      saving: false,
    })),
  );
  const [selected, select] = useState<string | null>(selectedFile);
  const [visible, setVisibleState] = useState<string[]>([]);
  const setVisible = useCallback((ids: string[]) => {
    setVisibleState((current) =>
      current.length === ids.length && current.every((id, i) => id === ids[i])
        ? current
        : ids,
    );
  }, []);
  const visibleKey = JSON.stringify(
    managedVisibility ? visible : selected ? [selected] : [],
  );
  const requests = useRef(
    new Map<string, { token: symbol; promise: Promise<void> }>(),
  );
  const lastVisible = useRef(new Map<string, number>());
  const previouslyVisible = useRef(new Set<string>());
  const [closing, setClosing] = useState<string | null>(null);
  const [imagePreview, previewImage] = useState<{
    project: string;
    path: string;
  } | null>(null);
  const closeResolution = useRef<{
    id: string;
    resolve: (closed: boolean) => void;
  } | null>(null);
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
  const load = useCallback(
    (file: OpenFile): Promise<void> => {
      const pending = requests.current.get(file.id);
      if (pending) return pending.promise;
      const token = Symbol(file.id);
      const apply = (fn: (file: OpenFile) => OpenFile) => {
        if (requests.current.get(file.id)?.token === token) update(file.id, fn);
      };
      // Schedule after registering the token, including when the bridge throws synchronously.
      const promise = Promise.resolve().then(async () => {
        try {
          if (file.mode === "diff") {
            const d = await call<FileDiff>("project_file_diff", {
              project: file.project,
              path: file.path,
              originalPath: file.originalPath || null,
            });
            apply((current) => ({
              ...current,
              content: d.modified,
              saved: d.modified,
              original: d.original,
              originalLabel: d.originalLabel,
              loading: false,
              unloaded: false,
              error: undefined,
            }));
          } else {
            const request = readOpenFile(file);
            const d = await call<FileContent>(request.command, request.args);
            apply((current) => ({
              ...current,
              ...d,
              saved: d.content,
              loading: false,
              unloaded: false,
              error: undefined,
            }));
          }
        } catch (error) {
          apply((current) => ({
            ...current,
            loading: false,
            unloaded: false,
            error: String(error),
          }));
        } finally {
          if (requests.current.get(file.id)?.token === token)
            requests.current.delete(file.id);
        }
      });
      requests.current.set(file.id, { token, promise });
      lastVisible.current.set(file.id, Date.now());
      return promise;
    },
    [update],
  );
  const openInEditor = useCallback(
    async (
      project: string,
      path: string,
      mode: "edit" | "diff" = "edit",
      originalPath?: string,
      skill?: import("@/lib/integrations").SkillTarget,
      instruction?: import("@/pages/Instructions").InstructionTarget,
      location?: import("@/lib/files").FileLocation,
    ) => {
      const id = fileId(project, path, mode);
      select(id);
      const existing = latest.current.find((f) => f.id === id);
      if (existing) {
        if (location) update(id, (f) => ({ ...f, location: { ...location } }));
        if (skill || instruction)
          update(id, (f) => ({ ...f, skill, instruction }));
        if (existing.unloaded) await load(existing);
        return;
      }
      const entry: OpenFile = {
        id,
        project,
        path,
        mode,
        originalPath,
        skill,
        instruction,
        location,
        content: "",
        saved: "",
        revision: "",
        loading: true,
        saving: false,
      };
      setFiles((rows) =>
        rows.some((f) => f.id === id) ? rows : [...rows, entry],
      );
      await load(entry);
    },
    [update, load],
  );
  const open = useCallback(
    async (...args: Parameters<typeof openInEditor>) => {
      const [project, path, mode = "edit", , skill, instruction] = args;
      if (mode === "edit" && imageFile(path) && !skill && !instruction) {
        previewImage({ project, path });
        return;
      }
      await openInEditor(...args);
    },
    [openInEditor],
  );
  // Restoring a session restores metadata only. Every visible split is loaded,
  // including panes that are visible but do not currently have keyboard focus.
  useEffect(() => {
    const ids = new Set<string>(JSON.parse(visibleKey));
    for (const file of files) {
      if (!ids.has(file.id)) continue;
      lastVisible.current.set(file.id, Date.now());
      if (file.unloaded) void load(file);
    }
  }, [visibleKey, files, load]);
  useEffect(() => {
    const ids = new Set<string>(JSON.parse(visibleKey));
    // Start the idle period when a file leaves the screen, not when it was read.
    for (const id of previouslyVisible.current) {
      if (!ids.has(id)) lastVisible.current.set(id, Date.now());
    }
    previouslyVisible.current = ids;
    const timer = setInterval(() => {
      const now = Date.now();
      setFiles((rows) => {
        let changed = false;
        const next = rows.map((file) => {
          if (
            ids.has(file.id) ||
            file.loading ||
            file.saving ||
            file.unloaded ||
            file.conflict ||
            dirtyFile(file) ||
            file.skillWriting ||
            now - (lastVisible.current.get(file.id) ?? now) < 30_000
          )
            return file;
          changed = true;
          return {
            ...file,
            content: "",
            saved: "",
            original: undefined,
            image: undefined,
            revision: "",
            error: undefined,
            unloaded: true,
            loading: true,
          };
        });
        return changed ? next : rows;
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [visibleKey]);
  const save = useCallback(
    async (id: string) => {
      const f = latest.current.find((f) => f.id === id);
      if (
        !f ||
        f.mode !== "edit" ||
        f.loading ||
        f.saving ||
        f.error ||
        f.conflict ||
        (imageFile(f.path) && !vectorFile(f.path))
      )
        return false;
      update(id, (x) => ({ ...x, saving: true }));
      try {
        const saved = f.instruction
          ? await call<FileContent>("save_instruction", {
              scope: f.instruction.scope,
              id: f.instruction.id,
              content: f.content,
              expected: f.revision,
            })
          : f.skill
            ? await call<FileContent>("integration_save_skill", {
                scope: f.skill.scope,
                id: f.skill.id,
                content: f.content,
                expected: f.revision,
              })
            : await call<FileContent>("save_project_file", {
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
          const disk = await call<FileContent>(
            readOpenFile(f).command,
            readOpenFile(f).args,
          );
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
      if (f.unloaded) {
        await load(f);
        return;
      }
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
            saved: d.modified,
            original: d.original,
            originalLabel: d.originalLabel,
            error: undefined,
          }));
        } else {
          const d = await call<FileContent>(
            readOpenFile(f).command,
            readOpenFile(f).args,
          );
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
    [update, load],
  );
  // Poll visible text files serially: slow disks must not accumulate requests.
  // Window visibility affects reads only, never Agent execution or scheduling.
  useEffect(() => {
    const ids = new Set<string>(JSON.parse(visibleKey));
    if (!ids.size) return;
    let stopped = false;
    let pending = false;
    const check = async () => {
      if (stopped || pending || document.hidden) return;
      pending = true;
      try {
        for (const id of ids) {
          if (stopped || document.hidden) break;
          const f = latest.current.find((file) => file.id === id);
          if (
            !f ||
            f.mode !== "edit" ||
            f.loading ||
            f.saving ||
            f.error ||
            (imageFile(f.path) && !vectorFile(f.path))
          )
            continue;
          try {
            const request = readOpenFile(f);
            const d = await call<FileContent>(request.command, request.args);
            if (!stopped && d.revision !== f.revision)
              update(id, (x) =>
                x.loading || x.saving || x.revision !== f.revision
                  ? x
                  : dirtyFile(x)
                    ? { ...x, conflict: d }
                    : { ...x, ...d, saved: d.content, conflict: undefined },
              );
          } catch {
            /* Saving explains missing or unreadable files. */
          }
        }
      } finally {
        pending = false;
      }
    };
    const timer = setInterval(() => void check(), 4000);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [visibleKey, update]);
  const discard = useCallback((id: string) => {
    requests.current.delete(id);
    lastVisible.current.delete(id);
    setFiles((rows) => rows.filter((f) => f.id !== id));
    select((current) => (current === id ? null : current));
    setClosing(null);
    if (closeResolution.current?.id === id) {
      closeResolution.current.resolve(true);
      closeResolution.current = null;
    }
  }, []);
  const close = useCallback(
    (id: string) => {
      const f = latest.current.find((f) => f.id === id);
      if (!f || f.saving) return false;
      if (dirtyFile(f)) {
        setClosing(id);
        return false;
      }
      discard(id);
      return true;
    },
    [discard],
  );
  const cancelClose = useCallback(() => {
    closeResolution.current?.resolve(false);
    closeResolution.current = null;
    setClosing(null);
  }, []);
  const closeAndWait = useCallback(
    (id: string): Promise<boolean> => {
      if (closeResolution.current) return Promise.resolve(false);
      const f = latest.current.find((file) => file.id === id);
      if (!f) return Promise.resolve(true);
      if (f.saving) return Promise.resolve(false);
      if (!dirtyFile(f)) {
        discard(id);
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        closeResolution.current = { id, resolve };
        setClosing(id);
      });
    },
    [discard],
  );
  useEffect(
    () => () => {
      closeResolution.current?.resolve(false);
      requests.current.clear();
    },
    [],
  );
  const dirty = files.some(dirtyFile);
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
    setVisible,
    selected,
    select,
    active: files.find((f) => f.id === selected),
    open,
    openInEditor,
    imagePreview,
    previewImage,
    save,
    reload,
    update,
    close,
    closeAndWait,
    cancelClose,
    discard,
    closing,
    version,
  };
}
