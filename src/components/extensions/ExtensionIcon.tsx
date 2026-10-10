import {
  Puzzle,
  NotebookPen,
  ListTodo,
  ChartNoAxesCombined,
  Code,
  Terminal,
  Folder,
  Workflow,
  Globe,
  PanelsTopLeft,
  Search,
  Check,
} from "lucide-react";
const icons = {
  puzzle: Puzzle,
  notebook: NotebookPen,
  list: ListTodo,
  chart: ChartNoAxesCombined,
  code: Code,
  terminal: Terminal,
  folder: Folder,
  workflow: Workflow,
  globe: Globe,
  layout: PanelsTopLeft,
  search: Search,
  check: Check,
};
export function ExtensionIcon({
  name,
  className = "size-4 shrink-0",
}: {
  name?: string;
  className?: string;
}) {
  const Icon = icons[name as keyof typeof icons] || Puzzle;
  return <Icon className={className} />;
}
