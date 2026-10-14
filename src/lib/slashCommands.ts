export type CommandCatalog = {
  commands: { name: string; description: string }[];
  models: { value: string; label: string }[];
};
export function slashCommand(text: string) {
  const match = text.trimStart().match(/^\/([\p{L}\p{N}_:.-]+)(?:\s|$)/u);
  return match
    ? {
        name: match[1],
        argument: text.trim().slice(match[0].trim().length).trim(),
      }
    : null;
}
