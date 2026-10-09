import { toast } from "sonner";

export async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("已复制");
  } catch {
    toast.error("复制失败，请手动选择文本复制");
  }
}
