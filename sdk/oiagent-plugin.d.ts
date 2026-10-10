/** OiAgent application extension API v1. Build your plugin into one plain JS file. */
interface OiAgentUiNode {
  type:
    | "stack"
    | "row"
    | "section"
    | "text"
    | "heading"
    | "code"
    | "badge"
    | "input"
    | "textarea"
    | "checkbox"
    | "select"
    | "button"
    | "table"
    | "separator";
  id?: string;
  text?: string;
  label?: string;
  value?: string | boolean;
  action?: string;
  variant?: "default" | "secondary" | "outline";
  disabled?: boolean;
  children?: OiAgentUiNode[];
  options?: { value: string; label: string }[];
  columns?: string[];
  rows?: string[][];
}
interface OiAgentTaskSummary {
  id: string;
  title: string;
  project: string;
  status: string;
  agentKind: string;
  deviceName: string;
  usage: { input: number; output: number; cached: number; known: boolean };
}
declare const oiagent: {
  onOpen(
    handler: (event: {
      viewId: string;
      settings: Record<string, string | boolean>;
      values: Record<string, string | boolean>;
    }) => unknown,
  ): void;
  onAction(
    handler: (event: {
      action: string;
      values: Record<string, string | boolean>;
    }) => unknown,
  ): void;
  ui: { render(tree: OiAgentUiNode): void };
  storage: {
    get(): Promise<Record<string, unknown>>;
    set(data: Record<string, unknown>): Promise<null>;
  };
  workspace: {
    getContext(): Promise<{ project: string | null; taskId: string | null }>;
  };
  tasks: {
    list(): Promise<OiAgentTaskSummary[]>;
    createDraft(value: { title?: string; prompt: string }): Promise<null>;
  };
  views: { open(viewId: string): Promise<null> };
  notify(message: string): Promise<null>;
};
