import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ClipboardEvent,
} from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { call, desktop } from "@/lib/api";
import type { Attachment } from "@/lib/types";
import { pasteMessage } from "@/lib/messageClipboard";

const MAX_TOTAL = 20 * 1024 * 1024;
export function mergeAttachments(previous: Attachment[], next: Attachment[]) {
  return [
    ...new Map([...previous, ...next].map((file) => [file.id, file])).values(),
  ];
}
function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = () => reject(new Error("无法读取文件"));
    reader.readAsDataURL(file);
  });
}
export function useAttachments(initial: Attachment[] = [], disabled = false) {
  const [items, setItems] = useState<Attachment[]>(initial);
  const [loading, setLoading] = useState(false);
  const lock = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bindInput = useCallback((node: HTMLTextAreaElement | null) => {
    inputRef.current = node;
  }, []);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function add(values: (File | string)[]) {
    if (disabled || !desktop) {
      toast.error("请在本机 Agent 对话中添加附件");
      return;
    }
    if (lock.current || !values.length) return;
    if (items.length + values.length > 10) {
      toast.error("每条消息最多添加 10 个附件");
      return;
    }
    lock.current = true;
    setLoading(true);
    let total = items.reduce((sum, file) => sum + file.size, 0);
    try {
      for (const value of values) {
        if (typeof value !== "string" && value.size + total > MAX_TOTAL)
          throw new Error("附件合计不能超过 20 MB");
        const file = await call<Attachment>(
          "stage_attachment",
          typeof value === "string"
            ? { path: value }
            : { name: value.name, data: await base64(value) },
        );
        total += file.size;
        if (total > MAX_TOTAL) throw new Error("附件合计不能超过 20 MB");
        if (mounted.current)
          setItems((previous) => mergeAttachments(previous, [file]));
      }
    } catch (error) {
      toast.error(String(error));
    } finally {
      lock.current = false;
      if (mounted.current) setLoading(false);
    }
  }
  const addPaths = useEffectEvent((paths: string[]) => {
    void add(paths);
  });
  useEffect(() => {
    const input = inputRef.current;
    const listener = (event: Event) => {
      addPaths((event as CustomEvent<string[]>).detail);
    };
    input?.addEventListener("oiagent-attach-files", listener);
    return () => input?.removeEventListener("oiagent-attach-files", listener);
  });
  async function pick() {
    if (disabled || lock.current) return;
    try {
      const paths = await open({
        multiple: true,
        directory: false,
        title: "添加附件",
      });
      if (paths) await add(Array.isArray(paths) ? paths : [paths]);
    } catch (error) {
      toast.error(String(error));
    }
  }
  function paste(
    event: ClipboardEvent<HTMLTextAreaElement>,
    onChange: (value: string) => void,
  ) {
    if (event.clipboardData.files.length) {
      event.preventDefault();
      void add(Array.from(event.clipboardData.files));
    } else pasteMessage(event, onChange);
  }
  return { items, setItems, loading, bindInput, disabled, add, pick, paste };
}
export type AttachmentDraft = ReturnType<typeof useAttachments>;
