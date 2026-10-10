/** Only these host-rendered controls are accepted. Plugin code never receives DOM nodes. */
export interface UiNode {
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
  children?: UiNode[];
  options?: { value: string; label: string }[];
  columns?: string[];
  rows?: string[][];
}
const types = new Set([
  "stack",
  "row",
  "section",
  "text",
  "heading",
  "code",
  "badge",
  "input",
  "textarea",
  "checkbox",
  "select",
  "button",
  "table",
  "separator",
]);
const fields = new Set(["input", "textarea", "checkbox", "select"]);
export function validateUi(value: unknown): UiNode {
  if (JSON.stringify(value)?.length > 128 * 1024)
    throw new Error("插件页面超过 128 KB");
  let count = 0;
  const ids = new Set<string>();
  function visit(value: unknown, depth: number): void {
    if (
      ++count > 400 ||
      depth > 12 ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    )
      throw new Error("插件页面结构无效或层级过深");
    const n = value as UiNode;
    if (!types.has(n.type)) throw new Error("不支持的插件组件");
    for (const key of ["id", "text", "label", "action"] as const)
      if (
        n[key] !== undefined &&
        (typeof n[key] !== "string" || n[key]!.length > 32000)
      )
        throw new Error("插件组件文字无效");
    if (n.disabled !== undefined && typeof n.disabled !== "boolean")
      throw new Error("disabled 必须为布尔值");
    if (
      n.value !== undefined &&
      typeof n.value !== "string" &&
      typeof n.value !== "boolean"
    )
      throw new Error("表单值无效");
    if (
      fields.has(n.type) &&
      n.value !== undefined &&
      typeof n.value !== (n.type === "checkbox" ? "boolean" : "string")
    )
      throw new Error("表单默认值类型无效");
    if (fields.has(n.type)) {
      if (
        !n.id ||
        !/^[a-zA-Z][\w.-]{0,79}$/.test(n.id) ||
        ids.has(n.id) ||
        !n.label
      )
        throw new Error("表单需要唯一 ID 和标签");
      ids.add(n.id);
    }
    if (n.type === "button" && (!n.action || !n.text))
      throw new Error("按钮缺少文字或 action");
    if (n.variant && !["default", "secondary", "outline"].includes(n.variant))
      throw new Error("按钮样式无效");
    if (
      n.options !== undefined &&
      (!Array.isArray(n.options) ||
        n.options.length > 100 ||
        n.options.some(
          (o) =>
            !o ||
            typeof o.value !== "string" ||
            !o.value ||
            typeof o.label !== "string",
        ))
    )
      throw new Error("选项无效");
    if (
      n.options &&
      new Set(n.options.map((o) => o.value)).size !== n.options.length
    )
      throw new Error("选项值不能重复");
    if (
      n.type === "table" &&
      (!Array.isArray(n.columns) ||
        n.columns.length > 12 ||
        !n.columns.every((c) => typeof c === "string") ||
        !Array.isArray(n.rows) ||
        n.rows.length > 200 ||
        n.rows.some(
          (row) =>
            !Array.isArray(row) ||
            row.length !== n.columns!.length ||
            !row.every((c) => typeof c === "string"),
        ))
    )
      throw new Error("表格无效或超过 200 行");
    if (n.children !== undefined) {
      if (
        !["stack", "row", "section"].includes(n.type) ||
        !Array.isArray(n.children)
      )
        throw new Error("组件不能包含子节点");
      n.children.forEach((c) => visit(c, depth + 1));
    }
  }
  visit(value, 0);
  return value as UiNode;
}

export function uiValues(node: UiNode): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  function visit(n: UiNode) {
    if (fields.has(n.type) && n.id)
      result[n.id] = n.value ?? (n.type === "checkbox" ? false : "");
    n.children?.forEach(visit);
  }
  visit(node);
  return result;
}
