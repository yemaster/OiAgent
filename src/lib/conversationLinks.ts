import { projectRelativePath } from "./editFiles";
import type { FileLocation } from "./files";

export type ConversationLink =
  | { kind: "web"; url: string }
  | { kind: "file"; path: string; location?: FileLocation };

export function conversationLink(
  value: string,
  project: string,
): ConversationLink | undefined {
  if (
    !value ||
    [...value].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    return;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.username || url.password) return;
      return { kind: "web", url: url.href };
    } catch {
      return;
    }
  }
  if (
    value.startsWith("#") ||
    value.startsWith("//") ||
    value.startsWith("\\\\")
  )
    return;
  let path = value;
  if (/^file:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      if (url.hostname && url.hostname !== "localhost") return;
      path = url.pathname + url.hash;
      if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
    } catch {
      return;
    }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path))
    return;
  try {
    path = decodeURIComponent(path);
  } catch {
    return;
  }
  const suffix =
    /(?::(\d+)(?::(\d+))?|#L(\d+)(?:C(\d+))?(?:-L?\d+(?:C\d+)?)?)$/i.exec(path);
  let location: FileLocation | undefined;
  if (suffix) {
    const line = Number(suffix[1] || suffix[3]);
    const column = Number(suffix[2] || suffix[4] || 1);
    if (
      !Number.isSafeInteger(line) ||
      line < 1 ||
      !Number.isSafeInteger(column) ||
      column < 1
    )
      return;
    location = { line, column };
    path = path.slice(0, suffix.index);
  } else {
    path = path.split("#")[0];
  }
  const relative = projectRelativePath(project, path);
  return relative ? { kind: "file", path: relative, location } : undefined;
}

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
};
/** Link explicit inline file references, leaving fenced code, commands and existing links alone. */
export function remarkFileLinks(project: string) {
  return () => (tree: MarkdownNode) => {
    function walk(node: MarkdownNode) {
      if (
        !node.children ||
        ["link", "linkReference", "code"].includes(node.type)
      )
        return;
      node.children = node.children.map((child) => {
        if (
          child.type === "inlineCode" &&
          child.value &&
          !/[\r\n]/.test(child.value) &&
          (!/\s/.test(child.value) ||
            /^(?:\/|\.{1,2}\/|[a-z]:[\\/]|file:\/\/)/i.test(child.value)) &&
          /(?:\.(?:tsx?|jsx?|mjs|cjs|jsonc?|mdx?|py|rs|go|java|kt|cpp|cc|c|hpp|h|css|scss|html?|vue|svelte|sh|bash|zsh|ya?ml|toml|ini|sql|xml|svg|png|jpe?g|gif|webp|bmp|ico|txt)|(?:^|[\\/])(?:Dockerfile|Makefile|LICENSE|\.gitignore|\.env))(?:[:#].*)?$/i.test(
            child.value,
          ) &&
          conversationLink(child.value, project)?.kind === "file"
        ) {
          return { type: "link", url: child.value, children: [child] };
        }
        walk(child);
        return child;
      });
    }
    walk(tree);
  };
}

/** Resolve Markdown document links relative to the file, without allowing root escape. */
export function remarkRelativeLinks(path: string) {
  return () => (tree: MarkdownNode) => {
    function walk(node: MarkdownNode) {
      if (
        (node.type === "link" || node.type === "image") &&
        node.url &&
        !/^(?:[a-z][a-z\d+.-]*:|\/|\\|#)/i.test(node.url)
      ) {
        const parts = path.replace(/\\/g, "/").split("/").slice(0, -1);
        for (const part of node.url.split("/")) {
          if (part === "..") {
            if (!parts.length) {
              node.url = "";
              return;
            }
            parts.pop();
          } else if (part !== ".") parts.push(part);
        }
        node.url = parts.join("/");
      }
      node.children?.forEach(walk);
    }
    walk(tree);
  };
}
