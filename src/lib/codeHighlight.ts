import hljs from "highlight.js/lib/common";
import { codeLanguage } from "./codeLanguage";

// Explicit language selection avoids expensive, unstable auto-detection on logs.
export function highlightCode(text: string, language: string): string | null {
  language = codeLanguage(language.toLowerCase());
  if (!hljs.getLanguage(language) || text.length > 50_000) return null;
  try {
    return hljs.highlight(text, { language, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}
