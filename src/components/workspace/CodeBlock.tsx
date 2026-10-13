import {
  Children,
  isValidElement,
  memo,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import "./code-block.css";

export const CodeBlock = memo(function CodeBlock({
  text,
  language = "",
  label,
  copyLabel = "复制代码",
  tone,
  className,
}: {
  text: string;
  language?: string;
  label?: string;
  copyLabel?: string;
  tone?: "before" | "after";
  className?: string;
}) {
  const [result, setResult] = useState<{
    text: string;
    language: string;
    html: string;
  }>();
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(
    typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    if (visible || !root.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!visible || !language || text.length > 50_000) return;
    let cancelled = false;
    // Coalesce streaming updates and keep the syntax engine out of startup.
    const timer = setTimeout(() => {
      void import("@/lib/codeHighlight")
        .then(({ highlightCode }) => {
          if (cancelled) return;
          const html = highlightCode(text, language);
          if (html !== null) setResult({ text, language, html });
        })
        .catch(() => {
          /* Plain text remains readable if the chunk cannot load. */
        });
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, language, visible]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  const html =
    result?.text === text && result.language === language
      ? result.html
      : undefined;
  return (
    <div
      ref={root}
      className={cn(
        "conversation-code my-3 min-w-0 overflow-hidden rounded-lg bg-muted/50",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs text-muted-foreground">
        <span
          className={cn(
            "truncate",
            tone === "before" && "text-red-700 dark:text-red-300",
            tone === "after" && "text-emerald-700 dark:text-emerald-300",
          )}
        >
          {label || language || "文本"}
        </span>
        <Button
          variant="ghost"
          size="xs"
          aria-label={copyLabel}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch {
              toast.error("复制失败，请手动复制");
            }
          }}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? "已复制" : "复制"}
        </Button>
      </div>
      <pre
        tabIndex={0}
        aria-label={label || language || "代码"}
        className="max-h-80 overflow-auto px-3 pb-3 font-mono text-xs leading-6"
      >
        {!text && <span className="text-muted-foreground">（空）</span>}
        {html === undefined ? (
          <code>{text}</code>
        ) : (
          // Only highlight.js output goes here; it escapes all source markup.
          <code dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </pre>
    </div>
  );
});

/** Handles fenced/indented blocks without changing inline code or its links. */
export function MarkdownCodeBlock({ children }: { children?: ReactNode }) {
  const child = Children.toArray(children)[0];
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child))
    return <pre>{children}</pre>;
  const text = Children.toArray(child.props.children).join("");
  const language =
    /language-([^\s]+)/.exec(child.props.className || "")?.[1] || "";
  return <CodeBlock text={text} language={language.toLowerCase()} />;
}
