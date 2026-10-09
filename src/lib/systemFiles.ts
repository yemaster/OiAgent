import { toast } from "sonner";
import { call, desktop } from "./api";

export function systemFileActions(
  project: string,
  path = "",
  disabled = false,
) {
  const run = (action: "reveal" | "open") => {
    void call("system_file_action", { project, path, action }).catch((e) =>
      toast.error(String(e)),
    );
  };
  return [
    {
      label: "在系统文件管理器中显示",
      separator: true,
      disabled: disabled || !desktop,
      action: () => run("reveal"),
    },
    {
      label: "使用默认程序打开",
      disabled: disabled || !desktop,
      action: () => run("open"),
    },
  ];
}
