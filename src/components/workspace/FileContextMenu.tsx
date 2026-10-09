import type { ReactElement } from "react";
import { FileCode2, GitCompareArrows, Copy } from "lucide-react";
import type { OpenProjectFile } from "@/lib/editFiles";
import { ContextActions } from "./ContextActions";
import { copyText } from "@/lib/clipboard";

export function FileContextMenu({
  children,
  project,
  path,
  originalPath,
  onOpen,
  directory = false,
  deleted = false,
  disabled = false,
  onToggle,
  expanded,
}: {
  children: ReactElement;
  project: string;
  path: string;
  originalPath?: string;
  onOpen?: OpenProjectFile;
  directory?: boolean;
  deleted?: boolean;
  disabled?: boolean;
  onToggle?: () => void;
  expanded?: boolean;
}) {
  return (
    <ContextActions
      actions={[
        ...(directory
          ? onToggle
            ? [
                {
                  label: expanded ? "收起文件夹" : "展开文件夹",
                  action: onToggle,
                  disabled,
                },
              ]
            : []
          : [
              {
                label: "打开文件",
                icon: <FileCode2 />,
                disabled: disabled || deleted || !onOpen,
                action: () => onOpen?.(project, path, "edit"),
              },
              {
                label: "查看工作区改动",
                icon: <GitCompareArrows />,
                disabled: disabled || !onOpen,
                action: () => onOpen?.(project, path, "diff", originalPath),
              },
            ]),
        {
          label: "复制相对路径",
          icon: <Copy />,
          separator: true,
          action: () => void copyText(path),
        },
        {
          label: "复制完整路径",
          action: () =>
            void copyText(
              path.startsWith("/") || /^[a-z]:/i.test(path)
                ? path
                : `${project.replace(/\/$/, "")}/${path}`,
            ),
        },
      ]}
    >
      {children}
    </ContextActions>
  );
}
