import { highlightCode } from "./codeHighlight";

self.onmessage = (
  event: MessageEvent<{ id: number; text: string; language: string }>,
) => {
  const { id, text, language } = event.data;
  self.postMessage({ id, html: highlightCode(text, language) });
};
