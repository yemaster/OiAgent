import { conversationLink } from "./conversationLinks";
import { projectRelativePath } from "./editFiles";
import type { Attachment } from "./types";

export type ConversationImage =
  | { kind: "file"; path: string }
  | { kind: "attachment"; id: string }
  | { kind: "web"; url: string }
  | { kind: "data"; url: string };

export function conversationImage(
  src: string,
  project: string,
  attachments: Attachment[] = [],
): ConversationImage | undefined {
  if (/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/=\r\n]+$/i.test(src)) {
    return src.length <= 28 * 1024 * 1024
      ? { kind: "data", url: src }
      : undefined;
  }
  // Only message-owned snapshots can be read outside the project.
  let path = src;
  try {
    if (/^file:\/\//i.test(path)) {
      const url = new URL(path);
      if (url.hostname && url.hostname !== "localhost") return;
      path = url.pathname.replace(/^\/([a-z]:\/)/i, "$1");
    }
    path = decodeURIComponent(path).replace(/\\/g, "/");
  } catch {
    return;
  }
  const attachment = attachments.find(
    (item) =>
      item.mime.startsWith("image/") && item.path.replace(/\\/g, "/") === path,
  );
  if (attachment) return { kind: "attachment", id: attachment.id };
  const target = conversationLink(src, project);
  if (target) return target;
  // Markdown percent-encodes Windows backslashes before the URL transform.
  // Resolve the decoded drive/UNC path once, still enforcing project containment.
  if (/^(?:[a-z]:\/|\/\/)/i.test(path)) {
    const relative = projectRelativePath(project, path);
    if (relative) return { kind: "file", path: relative };
  }
}
