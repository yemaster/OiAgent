import defaults from "./task-template-defaults.json";
export interface TaskTemplate {
  id: string;
  name: string;
  category: string;
  prompt: string;
}
export interface TemplateLibrary {
  templates: TaskTemplate[];
  revision: string;
}
export const defaultTemplates: TaskTemplate[] = defaults;
export function templateVariables(prompt: string): string[] {
  return [
    ...new Set(
      [...prompt.matchAll(/\{\{\s*([^{}\n]{1,64}?)\s*\}\}/g)].map((m) =>
        m[1].trim(),
      ),
    ),
  ];
}
export function fillTemplate(prompt: string, values: Record<string, string>) {
  return prompt.replace(
    /\{\{\s*([^{}\n]{1,64}?)\s*\}\}/g,
    (raw, key: string) =>
      typeof values[key.trim()] === "string"
        ? values[key.trim()].trim() || raw
        : raw,
  );
}
export function insertTemplate(
  current: string,
  incoming: string,
  replace = false,
) {
  return replace || !current.trim()
    ? incoming
    : `${current.trimEnd()}\n\n${incoming}`;
}
// Browser preview has its own library; desktop templates live in the app data directory.
export function browserTemplates(): TemplateLibrary {
  const text = localStorage.getItem("oiagent-task-templates");
  if (!text)
    return {
      templates: structuredClone(defaultTemplates),
      revision: "initial",
    };
  const value = JSON.parse(text) as TemplateLibrary;
  if (!Array.isArray(value.templates) || typeof value.revision !== "string")
    throw new Error("浏览器模板数据异常");
  return value;
}
export function saveBrowserTemplate(
  args: Record<string, unknown>,
  remove = false,
) {
  const library = browserTemplates();
  if (library.revision !== args.expected) throw new Error("模板已修改，请刷新");
  if (remove)
    library.templates = library.templates.filter((t) => t.id !== args.id);
  else {
    const template = { ...(args.template as TaskTemplate) };
    if (
      !template.name.trim() ||
      !template.prompt.trim() ||
      template.prompt.length > 32768
    )
      throw new Error("请填写名称和有效的 Prompt");
    if (template.id) {
      const i = library.templates.findIndex((t) => t.id === template.id);
      if (i < 0) throw new Error("模板不存在");
      library.templates[i] = template;
    } else {
      template.id = crypto.randomUUID();
      library.templates.push(template);
    }
  }
  library.revision = crypto.randomUUID();
  localStorage.setItem("oiagent-task-templates", JSON.stringify(library));
  return library;
}
