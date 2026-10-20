import { systemFileActions } from "@/lib/systemFiles";
import type { ReactElement } from "react";
import { FileCode2, GitCompareArrows, Copy } from "lucide-react";
import type { OpenProjectFile } from "@/lib/editFiles";
import { ContextActions } from "./ContextActions";
import { copyText } from "@/lib/clipboard";
import { copyImage } from "@/lib/imageClipboard";
import { call } from "@/lib/api";
import { imageFile, type FileContent } from "@/lib/files";

export function FileContextMenu({
  children,
  project,
  path,
  originalPath,
  onOpen,
  onViewChange,
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
  onViewChange?: () => void;
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
                label: onViewChange ? "查看本次改动" : "查看工作区改动",
                icon: <GitCompareArrows />,
                disabled: !onViewChange && (disabled || !onOpen),
                action:
                  onViewChange ||
                  (() => onOpen?.(project, path, "diff", originalPath)),
              },
            ]),
        ...systemFileActions(
          project,
          path,
          disabled || deleted || (!directory && !onOpen),
        ),
        ...(!directory && imageFile(path)
          ? [
              {
                label: "复制图片",
                disabled: disabled || deleted || !onOpen,
                action: () =>
                  void copyImage(async () => {
                    const data = await call<FileContent>("read_project_image", {
                      project,
                      path,
                    });
                    if (!data.image) throw new Error("无法读取图片");
                    return data.image.url;
                  }),
              },
            ]
          : []),
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
