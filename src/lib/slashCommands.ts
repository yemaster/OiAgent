export type CommandCatalog = {
  commands: { name: string; description: string }[];
  models: { value: string; label: string }[];
};
export const newChatCommands = [
  { name: "new", description: "在当前项目新建聊天" },
  { name: "clear", description: "新建空白聊天，保留当前记录" },
];
export function isNewChatCommand(name: string) {
  return newChatCommands.some((command) => command.name === name);
}
export function slashCommand(text: string) {
  const match = text.trimStart().match(/^\/([\p{L}\p{N}_:.-]+)(?:\s|$)/u);
  return match
    ? {
        name: match[1],
        argument: text.trim().slice(match[0].trim().length).trim(),
      }
    : null;
}
