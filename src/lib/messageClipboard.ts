import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import type { ClipboardEvent } from "react";

const markdown = new TurndownService({
  codeBlockStyle: "fenced",
  headingStyle: "atx",
  bulletListMarker: "-",
});
markdown.use(gfm);
markdown.remove(
  (node) =>
    node.hasAttribute("data-copy-ignore") ||
    ["SCRIPT", "STYLE", "BUTTON", "SVG", "NOSCRIPT"].includes(
      node.nodeName.toUpperCase(),
    ),
);
// Code toolbars are not message text. Preserve the language on fenced blocks.
markdown.addRule("highlighted-code", {
  filter: "pre",
  replacement: (_content, node) => {
    const code = node.querySelector("code");
    const text = (code || node).textContent || "";
    const language = code?.className.match(/language-([\w+-]+)/)?.[1] || "";
    const fence = "`".repeat(
      Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)),
    );
    return `\n\n${fence}${language}\n${text.replace(/\n$/, "")}\n${fence}\n\n`;
  },
});

export function htmlToMarkdown(html: string): string {
  return markdown.turndown(html);
}

/** A native textarea paste preserves plain text; rich text is converted, not flattened. */
export function pasteMessage(
  event: ClipboardEvent<HTMLTextAreaElement>,
  onChange: (value: string) => void,
) {
  const html = event.clipboardData.getData("text/html");
  if (!html || event.clipboardData.files.length) return;
  // Editors often copy syntax-colored spans rather than semantic HTML. Their
  // plain-text payload preserves indentation and Markdown source exactly.
  if (
    /white-space:\s*pre(?:-wrap)?/i.test(html) &&
    !/<(?:h[1-6]|strong|em|ul|ol|table|pre)\b/i.test(html)
  )
    return;
  // Our own copy handler already supplies the exact Markdown as plain text.
  const text =
    event.clipboardData.getData("text/x-oiagent-markdown") ||
    htmlToMarkdown(html);
  if (!text) return;
  event.preventDefault();
  const input = event.currentTarget;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  onChange(input.value.slice(0, start) + text + input.value.slice(end));
  requestAnimationFrame(() =>
    input.setSelectionRange(start + text.length, start + text.length),
  );
}

export function copyMessageSelection(event: ClipboardEvent<HTMLElement>) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  if (!event.currentTarget.contains(range.commonAncestorContainer)) return;
  const text = selectedMessageText();
  if (!text) return;
  event.preventDefault();
  event.clipboardData.setData("text/plain", text);
  event.clipboardData.setData("text/x-oiagent-markdown", text);
}

export function selectedMessageText(): string {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return "";
  const range = selection.getRangeAt(0);
  const ancestor = range.commonAncestorContainer;
  const element =
    ancestor.nodeType === Node.ELEMENT_NODE
      ? (ancestor as Element)
      : ancestor.parentElement;
  if (element?.closest("pre")) return selection.toString();
  const fragment = document.createElement("div");
  const contents = range.cloneContents();
  if (element?.matches("strong, b, em, i, code, a, h1, h2, h3, h4, h5, h6")) {
    const wrapper = element.cloneNode(false);
    wrapper.appendChild(contents);
    fragment.append(wrapper);
  } else fragment.append(contents);
  return htmlToMarkdown(fragment.innerHTML);
}
