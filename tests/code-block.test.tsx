import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import ReactMarkdown from "react-markdown";
import { CodeBlock, MarkdownCodeBlock } from "@/components/workspace/CodeBlock";
import { highlightCode } from "@/lib/codeHighlight";

it("highlights fenced code, copies exact source, and leaves inline code inline", async () => {
  const user = userEvent.setup();
  const copy = vi.spyOn(navigator.clipboard, "writeText");
  const source = 'const message = "hello";\n';
  const { container } = render(
    <ReactMarkdown components={{ pre: MarkdownCodeBlock }}>
      {"Inline `hello`.\n\n```js\n" + source + "```"}
    </ReactMarkdown>,
  );
  await waitFor(() =>
    expect(container.querySelector(".hljs-keyword")).toHaveTextContent("const"),
  );
  expect(container.querySelector("p > code")).toHaveTextContent("hello");
  await user.click(screen.getByRole("button", { name: "复制代码" }));
  expect(copy).toHaveBeenCalledWith(source);
  expect(screen.getByText("已复制")).toBeVisible();
});

it("escapes source markup and falls back for unknown languages and large logs", () => {
  const html = highlightCode('<script>alert("x")</script>', "xml")!;
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;");
  expect(highlightCode("x".repeat(50_001), "javascript")).toBeNull();
  expect(highlightCode("hello", "unknown-language")).toBeNull();
});

it("never leaves stale highlighted text after streaming content changes", async () => {
  const { container, rerender } = render(
    <CodeBlock text="const a = 1" language="js" />,
  );
  await waitFor(() =>
    expect(container.querySelector(".hljs-keyword")).not.toBeNull(),
  );
  rerender(<CodeBlock text="next <unsafe>" language="unknown" />);
  expect(container.querySelector("pre code")?.textContent).toBe(
    "next <unsafe>",
  );
  expect(container.querySelector("unsafe")).toBeNull();
});
