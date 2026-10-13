import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  setConfirmExternalLinks,
  useConfirmExternalLinks,
} from "@/lib/linkPreferences";

export function ExternalLinkSettings() {
  const confirm = useConfirmExternalLinks();
  return (
    <div className="flex items-center justify-between gap-6 py-5">
      <div>
        <Label htmlFor="confirm-external-links">打开外部链接前确认</Label>
        <p className="mt-2 text-xs text-muted-foreground">
          关闭后，对话中的网页链接会直接在浏览器中打开。
        </p>
      </div>
      <Switch
        id="confirm-external-links"
        checked={confirm}
        onCheckedChange={(value) => {
          try {
            setConfirmExternalLinks(value);
          } catch {
            toast.error("偏好保存失败，请重试");
          }
        }}
      />
    </div>
  );
}
