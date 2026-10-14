import { Button } from "@/components/ui/button";
import type { CommandCatalog } from "@/lib/slashCommands";

export function SlashCommands({
  prompt,
  catalog,
  onChoose,
  onTerminal,
}: {
  prompt: string;
  catalog: CommandCatalog;
  onChoose: (name: string) => void;
  onTerminal: () => void;
}) {
  if (!/^\/[\p{L}\p{N}_:.-]*$/u.test(prompt)) return null;
  const query = prompt.slice(1).toLowerCase();
  const commands = [
    { name: "model", description: "切换模型" },
    ...catalog.commands.filter((c) => c.name !== "model"),
  ].filter((c) => c.name.toLowerCase().includes(query));
  return (
    <div
      className="mb-2 rounded-lg border bg-popover p-1 shadow-sm"
      aria-label="斜杠命令"
    >
      <div className="max-h-48 overflow-y-auto">
        {commands.map((command) => (
          <Button
            key={command.name}
            variant="ghost"
            className="flex h-auto w-full justify-start gap-3 px-3 py-2 text-left"
            onClick={() => onChoose(command.name)}
          >
            <span className="shrink-0 font-mono text-xs">/{command.name}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">
              {command.description}
            </span>
          </Button>
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start text-muted-foreground"
        onClick={onTerminal}
      >
        在原生终端中使用命令
      </Button>
    </div>
  );
}
