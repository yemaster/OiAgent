import { createContext } from "react";
import { plain, type TranscriptItem } from "./transcript";

export interface ConversationMatch {
  id: string;
  path: string[];
  text: string;
  offset: number;
  query: string;
}
export const ConversationSearchContext =
  createContext<ConversationMatch | null>(null);

/** Cache readable text, not raw metadata, for unchanged IPC records. */
export function createConversationSearch() {
  const texts = new WeakMap<object, { text: string; folded: string }>();
  function text(item: TranscriptItem) {
    const source = item.kind === "message" ? item.message : item.tool;
    let value = texts.get(source);
    if (value === undefined) {
      const readable =
        item.kind === "message"
          ? item.message.text
          : [
              item.tool.name,
              plain(item.tool.input),
              plain(item.tool.output),
              plain(item.tool.fileResult),
            ]
              .filter(Boolean)
              .join("\n");
      value = { text: readable, folded: readable.toLocaleLowerCase() };
      texts.set(source, value);
    }
    return value;
  }
  return (items: TranscriptItem[], input: string): ConversationMatch[] => {
    const query = input.trim();
    if (!query) return [];
    const needle = query.toLocaleLowerCase();
    const matches: ConversationMatch[] = [];
    function visit(items: TranscriptItem[], parents: string[]) {
      for (const item of items) {
        const path = [...parents, item.key];
        const value = text(item);
        const offset = value.folded.indexOf(needle);
        if (offset >= 0)
          matches.push({
            id: JSON.stringify(path),
            path,
            text: value.text,
            offset,
            query,
          });
        if (item.kind === "tool") visit(item.nested, path);
      }
    }
    visit(items, []);
    return matches;
  };
}
