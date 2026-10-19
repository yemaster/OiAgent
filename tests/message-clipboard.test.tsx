import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  htmlToMarkdown,
  pasteMessage,
  selectedMessageText,
} from "@/lib/messageClipboard";
import { ConversationText } from "@/components/workspace/Transcript";

it("preserves headings, lists, links, tables and fenced code without toolbar text", () => {
  const text = htmlToMarkdown(
    '<h2>步骤</h2><ol><li><strong>读取</strong></li><li>修改</li></ol><div data-copy-ignore>typescript<button>复制</button></div><pre><code class="language-ts">const x = 1;\n  run(x);\n</code></pre><p>第一行<br>第二行</p>',
  );
  expect(text).toContain("## 步骤");
  expect(text).toMatch(/1\.\s+\*\*读取\*\*/);
  expect(text).toContain("```ts\nconst x = 1;\n  run(x);\n```");
  expect(text).toMatch(/第一行.*\n第二行/);
  expect(text).not.toContain("复制");
  expect(text).not.toContain("typescript");
});
it("keeps a code-only selection's indentation and newlines", () => {
  document.body.innerHTML = "<pre><code>  first\n\n    second</code></pre>";
  const range = document.createRange();
  range.selectNodeContents(document.querySelector("code")!);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  expect(selectedMessageText()).toBe("  first\n\n    second");
  window.getSelection()!.removeAllRanges();
  document.body.innerHTML = "";
});
it("replaces only selected input text on rich paste and leaves plain paste native", () => {
  const onChange = vi.fn();
  render(
    <textarea
      defaultValue="before remove after"
      onPaste={(event) => pasteMessage(event, onChange)}
    />,
  );
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  input.setSelectionRange(7, 13);
  fireEvent.paste(input, {
    clipboardData: {
      files: [],
      getData: (type: string) =>
        type === "text/html" ? "<strong>new</strong><br>line" : "",
    },
  });
  expect(onChange).toHaveBeenCalledWith("before **new**  \nline after");
  onChange.mockClear();
  expect(
    fireEvent.paste(input, { clipboardData: { files: [], getData: () => "" } }),
  ).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
});
it("renders user single line breaks and Markdown together", () => {
  const { container } = render(
    <ConversationText
      text={"第一行\n第二行\n\n**重点**\n\n```js\nlet a = 1;\n```"}
      user
      project="/tmp"
    />,
  );
  expect(container.querySelector("p br")).toBeInTheDocument();
  expect(container.querySelector("strong")).toHaveTextContent("重点");
  expect(container.querySelector("code")).toHaveTextContent("let a = 1;");
});
