export interface StorageItem {
  id: string;
  category: string;
  name: string;
  paths: string[];
  bytes: number;
  revision: string;
  blockedReason: string | null;
  effect: string;
  cleanupAfter: string | null;
  partial: boolean;
}
export interface StorageReport {
  dataDir: string;
  totalBytes: number;
  cleanableBytes: number;
  items: StorageItem[];
  partial: boolean;
  retentionDays: number;
}
export interface StorageDeleteResult {
  deletedItems: string[];
  deletedIds: string[];
  deletedProjects: string[];
  failures: { id: string; message: string }[];
}
export const storageCategories = [
  ["conversations", "临时对话"],
  ["projects", "临时项目"],
  ["temporary", "临时文件"],
  ["records", "会话记录与日志"],
  ["attachments", "附件"],
  ["runtime", "Agent 运行组件"],
  ["cache", "缓存与索引"],
  ["kept", "已保留项目"],
  ["other", "设置与其他数据"],
] as const;

export function storageSize(bytes: number) {
  if (!bytes) return "0 B";
  const unit = Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** unit).toLocaleString("zh-CN", { maximumFractionDigits: unit ? 1 : 0 })} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
}
